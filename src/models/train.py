"""
train.py
--------
Training loop for HealthTwin fusion model + ablation variants + baselines.

Training strategy:
  - Joint loss: weighted BCE (classification) + MSE (forecast), lambda=0.3
  - Weighted BCE uses pos_weight from class_balance.json to handle imbalance
  - AdamW optimizer, cosine LR schedule, gradient clipping
  - Early stopping on val AUROC (patience=7)
  - Temperature scaling calibration on val set after training

Saves to results/:
  - fusion_model.pt         (best checkpoint)
  - ablation_glucose.pt
  - ablation_wearables.pt
  - logreg.pkl
  - xgboost.pkl
  - calibration_temp.json   (temperature T for scaling)
"""

import os
import sys
import json
import pickle
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import roc_auc_score

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE = os.path.join(os.path.dirname(__file__), "../..")
PROC_DIR = os.path.join(BASE, "data/processed")
RESULTS_DIR = os.path.join(BASE, "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

sys.path.insert(0, os.path.join(BASE, "src"))
from models.fusion_model import FusionModel, GlucoseOnlyModel, WearablesNoEHRModel
from models.baselines import train_baselines

# ── Hyperparameters ────────────────────────────────────────────────────────────
BATCH_SIZE    = 2048
MAX_EPOCHS    = 20
LR            = 3e-4
WEIGHT_DECAY  = 1e-4
PATIENCE      = 5
LAMBDA_FORE   = 0.01   # small weight: forecast MSE on normalized [0,1] targets
DROPOUT       = 0.3
GRAD_CLIP     = 1.0
DEVICE        = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Glucose normalization for forecast head targets
GLUCOSE_MIN = 55.0
GLUCOSE_MAX = 400.0

# For CPU-only POC: subsample training data to keep training tractable.
# Set to None to use full dataset (recommended with GPU).
TRAIN_SUBSAMPLE = 40_000
VAL_SUBSAMPLE   = 10_000


def load_split(split: str) -> tuple:
    X_ts  = np.load(os.path.join(PROC_DIR, f"X_ts_{split}.npy"))
    X_ehr = np.load(os.path.join(PROC_DIR, f"X_ehr_{split}.npy"))
    y     = np.load(os.path.join(PROC_DIR, f"y_{split}.npy"))
    yf    = np.load(os.path.join(PROC_DIR, f"y_forecast_{split}.npy"))
    return X_ts, X_ehr, y, yf


def make_loader(X_ts, X_ehr, y, yf, shuffle: bool, batch_size: int = BATCH_SIZE) -> DataLoader:
    ds = TensorDataset(
        torch.tensor(X_ts,  dtype=torch.float32),
        torch.tensor(X_ehr, dtype=torch.float32),
        torch.tensor(y,     dtype=torch.float32),
        torch.tensor(yf,    dtype=torch.float32),
    )
    return DataLoader(ds, batch_size=batch_size, shuffle=shuffle,
                      num_workers=0, pin_memory=False)


def train_one_model(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    pos_weight: float,
    model_name: str,
) -> dict:
    """Train a single model, return best val metrics."""
    model = model.to(DEVICE)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=MAX_EPOCHS)

    bce_loss = nn.BCELoss(weight=None)  # pos_weight applied manually
    pw = torch.tensor([pos_weight], device=DEVICE)
    bce_weighted = nn.BCEWithLogitsLoss(pos_weight=pw)
    mse_loss = nn.MSELoss()

    best_auroc = 0.0
    best_epoch = 0
    patience_counter = 0
    best_state = None

    print(f"\n  [{model_name}] Training on {DEVICE} ...")

    for epoch in range(MAX_EPOCHS):
        # ── Train ──────────────────────────────────────────────────────────────
        model.train()
        train_loss = 0.0
        for x_ts, x_ehr, y_cls, y_fore in train_loader:
            x_ts  = x_ts.to(DEVICE)
            x_ehr = x_ehr.to(DEVICE)
            y_cls = y_cls.to(DEVICE)
            y_fore = y_fore.to(DEVICE)

            optimizer.zero_grad()
            prob, forecast = model(x_ts, x_ehr)

            # Weighted BCE via logits trick: re-compute logit from prob
            logit = torch.logit(prob.clamp(1e-6, 1 - 1e-6))
            loss_cls  = bce_weighted(logit, y_cls)
            # Normalize forecast targets to [0,1] before MSE
            y_fore_norm = (y_fore - GLUCOSE_MIN) / (GLUCOSE_MAX - GLUCOSE_MIN)
            fore_norm   = (forecast - GLUCOSE_MIN) / (GLUCOSE_MAX - GLUCOSE_MIN)
            loss_fore = mse_loss(fore_norm, y_fore_norm)
            loss = loss_cls + LAMBDA_FORE * loss_fore

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
            optimizer.step()
            train_loss += loss.item()

        scheduler.step()

        # ── Validate ───────────────────────────────────────────────────────────
        model.eval()
        all_probs, all_labels = [], []
        val_loss = 0.0
        with torch.no_grad():
            for x_ts, x_ehr, y_cls, y_fore in val_loader:
                x_ts  = x_ts.to(DEVICE)
                x_ehr = x_ehr.to(DEVICE)
                y_cls = y_cls.to(DEVICE)
                y_fore = y_fore.to(DEVICE)

                prob, forecast = model(x_ts, x_ehr)
                logit = torch.logit(prob.clamp(1e-6, 1 - 1e-6))
                loss_cls  = bce_weighted(logit, y_cls)
                y_fore_norm = (y_fore - GLUCOSE_MIN) / (GLUCOSE_MAX - GLUCOSE_MIN)
                fore_norm   = (forecast - GLUCOSE_MIN) / (GLUCOSE_MAX - GLUCOSE_MIN)
                loss_fore = mse_loss(fore_norm, y_fore_norm)
                val_loss += (loss_cls + LAMBDA_FORE * loss_fore).item()

                all_probs.extend(prob.cpu().numpy().tolist())
                all_labels.extend(y_cls.cpu().numpy().tolist())

        auroc = roc_auc_score(all_labels, all_probs)
        avg_train = train_loss / len(train_loader)
        avg_val   = val_loss   / len(val_loader)

        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"    Epoch {epoch+1:3d}/{MAX_EPOCHS} | "
                  f"train_loss={avg_train:.4f} | val_loss={avg_val:.4f} | "
                  f"val_AUROC={auroc:.4f}")

        if auroc > best_auroc:
            best_auroc = auroc
            best_epoch = epoch + 1
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= PATIENCE:
                print(f"    Early stop at epoch {epoch+1} (best epoch={best_epoch})")
                break

    # Restore best
    if best_state:
        model.load_state_dict(best_state)

    print(f"  [{model_name}] Best val AUROC={best_auroc:.4f} (epoch {best_epoch})")
    return {"best_val_auroc": best_auroc, "best_epoch": best_epoch}


def temperature_scaling(model: nn.Module, val_loader: DataLoader) -> float:
    """
    Fit a single temperature parameter T on the val set (isotonic alternative).
    Returns calibrated temperature T.
    """
    from scipy.optimize import minimize_scalar
    from sklearn.metrics import log_loss

    model.eval()
    all_logits, all_labels = [], []

    with torch.no_grad():
        for x_ts, x_ehr, y_cls, _ in val_loader:
            x_ts  = x_ts.to(DEVICE)
            x_ehr = x_ehr.to(DEVICE)
            prob, _ = model(x_ts, x_ehr)
            logit = torch.logit(prob.clamp(1e-6, 1 - 1e-6))
            all_logits.extend(logit.cpu().numpy().tolist())
            all_labels.extend(y_cls.numpy().tolist())

    logits = np.array(all_logits)
    labels = np.array(all_labels)

    def nll(T):
        scaled_probs = 1 / (1 + np.exp(-logits / T))
        scaled_probs = np.clip(scaled_probs, 1e-7, 1 - 1e-7)
        return log_loss(labels, scaled_probs)

    result = minimize_scalar(nll, bounds=(0.1, 10.0), method="bounded")
    T = float(result.x)
    print(f"  Temperature scaling: T = {T:.4f}")
    return T


def main():
    print(f"Loading data from {PROC_DIR} ...")
    X_ts_tr, X_ehr_tr, y_tr, yf_tr = load_split("train")
    X_ts_vl, X_ehr_vl, y_vl, yf_vl = load_split("val")
    X_ts_te, X_ehr_te, y_te, yf_te = load_split("test")

    with open(os.path.join(PROC_DIR, "class_balance.json")) as f:
        cb = json.load(f)
    pos_weight = cb["train"]["pos_weight"]
    print(f"  pos_weight (train): {pos_weight:.3f}")
    print(f"  Train: {len(y_tr):,} | Val: {len(y_vl):,} | Test: {len(y_te):,}")

    ehr_dim = X_ehr_tr.shape[1]
    ts_dim  = X_ts_tr.shape[2]

    # Optionally subsample for CPU-only training
    if TRAIN_SUBSAMPLE and len(y_tr) > TRAIN_SUBSAMPLE:
        rng = np.random.default_rng(42)
        idx = rng.choice(len(y_tr), TRAIN_SUBSAMPLE, replace=False)
        X_ts_tr  = X_ts_tr[idx];  X_ehr_tr  = X_ehr_tr[idx]
        y_tr     = y_tr[idx];     yf_tr     = yf_tr[idx]
        print(f"  [Subsample] Using {TRAIN_SUBSAMPLE:,} / {len(y_tr)+len(idx):,} train windows for CPU training")

    if VAL_SUBSAMPLE and len(y_vl) > VAL_SUBSAMPLE:
        rng = np.random.default_rng(43)
        idx = rng.choice(len(y_vl), VAL_SUBSAMPLE, replace=False)
        X_ts_vl  = X_ts_vl[idx];  X_ehr_vl  = X_ehr_vl[idx]
        y_vl     = y_vl[idx];     yf_vl     = yf_vl[idx]

    train_loader = make_loader(X_ts_tr, X_ehr_tr, y_tr, yf_tr, shuffle=True)
    val_loader   = make_loader(X_ts_vl, X_ehr_vl, y_vl, yf_vl, shuffle=False)

    training_log = {}

    # ── 1. Full fusion model ───────────────────────────────────────────────────
    print("\n=== Full Fusion Model ===")
    fusion = FusionModel(ehr_input_dim=ehr_dim, ts_input_dim=ts_dim, dropout=DROPOUT)
    res = train_one_model(fusion, train_loader, val_loader, pos_weight, "FusionModel")
    training_log["fusion"] = res
    torch.save(fusion.state_dict(), os.path.join(RESULTS_DIR, "fusion_model.pt"))

    # Temperature calibration
    T = temperature_scaling(fusion, val_loader)
    with open(os.path.join(RESULTS_DIR, "calibration_temp.json"), "w") as f:
        json.dump({"temperature": T}, f)

    # ── 2. Ablation: glucose only ──────────────────────────────────────────────
    print("\n=== Ablation: Glucose Only ===")
    gluc_model = GlucoseOnlyModel(dropout=DROPOUT)
    res = train_one_model(gluc_model, train_loader, val_loader, pos_weight, "GlucoseOnly")
    training_log["ablation_glucose"] = res
    torch.save(gluc_model.state_dict(), os.path.join(RESULTS_DIR, "ablation_glucose.pt"))

    # ── 3. Ablation: wearables, no EHR ────────────────────────────────────────
    print("\n=== Ablation: Wearables (no EHR) ===")
    wear_model = WearablesNoEHRModel(ts_input_dim=ts_dim, dropout=DROPOUT)
    res = train_one_model(wear_model, train_loader, val_loader, pos_weight, "WearablesNoEHR")
    training_log["ablation_wearables"] = res
    torch.save(wear_model.state_dict(), os.path.join(RESULTS_DIR, "ablation_wearables.pt"))

    # ── 4. Baselines ──────────────────────────────────────────────────────────
    print("\n=== Baselines ===")
    baseline_results = train_baselines(
        X_ts_tr, X_ehr_tr, y_tr,
        X_ts_vl, X_ehr_vl, y_vl,
        pos_weight=pos_weight,
        save_dir=RESULTS_DIR,
    )
    training_log["baselines"] = baseline_results

    # ── Save training log ──────────────────────────────────────────────────────
    with open(os.path.join(RESULTS_DIR, "training_log.json"), "w") as f:
        json.dump(training_log, f, indent=2)

    print("\n[OK] Training complete. Models saved to results/")
    print("     Run 'python src/models/evaluate.py' next.")


if __name__ == "__main__":
    main()
