"""
evaluate.py
-----------
Loads trained models, evaluates on the held-out test set, and writes
ALL metrics to results/metrics.json.  The UI and README read from this file.

NEVER hardcode metric values — all numbers come from model inference here.

Metrics computed:
  Classification (per model):
    - AUROC, AUPRC, Precision, Recall, F1, Specificity
    - Confusion matrix (TP, FP, TN, FN)
    - ECE (Expected Calibration Error, 15 bins)
    - Probability interval coverage (5th-95th pct from MC dropout)

  Forecast (fusion model):
    - MAE and RMSE at +30 / +60 / +90 / +120 min

  Ablation table:
    - glucose_only | +wearables | +EHR_full | xgboost | logreg

Saves:
  results/metrics.json
  results/plots/roc_curve.png
  results/plots/calibration_curve.png
  results/plots/confusion_matrix.png
"""

import os
import sys
import json
import pickle
import numpy as np
import torch
import torch.nn as nn
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from sklearn.metrics import (
    roc_auc_score, average_precision_score, precision_score,
    recall_score, f1_score, confusion_matrix, roc_curve,
    precision_recall_curve,
)
from torch.utils.data import DataLoader, TensorDataset

BASE = os.path.join(os.path.dirname(__file__), "../..")
sys.path.insert(0, os.path.join(BASE, "src"))

PROC_DIR    = os.path.join(BASE, "data/processed")
RESULTS_DIR = os.path.join(BASE, "results")
PLOTS_DIR   = os.path.join(RESULTS_DIR, "plots")
os.makedirs(PLOTS_DIR, exist_ok=True)

from models.fusion_model import FusionModel, GlucoseOnlyModel, WearablesNoEHRModel
from models.baselines import extract_features

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
BATCH  = 2048
N_MC   = 10   # MC dropout samples (reduced for CPU inference speed)


def load_split(split: str):
    X_ts  = np.load(os.path.join(PROC_DIR, f"X_ts_{split}.npy"))
    X_ehr = np.load(os.path.join(PROC_DIR, f"X_ehr_{split}.npy"))
    y     = np.load(os.path.join(PROC_DIR, f"y_{split}.npy"))
    yf    = np.load(os.path.join(PROC_DIR, f"y_forecast_{split}.npy"))
    return X_ts, X_ehr, y, yf


def make_loader(X_ts, X_ehr, y, yf) -> DataLoader:
    ds = TensorDataset(
        torch.tensor(X_ts,  dtype=torch.float32),
        torch.tensor(X_ehr, dtype=torch.float32),
        torch.tensor(y,     dtype=torch.float32),
        torch.tensor(yf,    dtype=torch.float32),
    )
    return DataLoader(ds, batch_size=BATCH, shuffle=False, num_workers=0)


def ece(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 15) -> float:
    """Expected Calibration Error."""
    bins = np.linspace(0, 1, n_bins + 1)
    ece_val = 0.0
    for i in range(n_bins):
        mask = (y_prob >= bins[i]) & (y_prob < bins[i + 1])
        if mask.sum() == 0:
            continue
        acc  = y_true[mask].mean()
        conf = y_prob[mask].mean()
        ece_val += mask.mean() * abs(acc - conf)
    return float(ece_val)


def get_predictions_nn(model: nn.Module, loader: DataLoader,
                       temperature: float = 1.0) -> tuple:
    model.eval()
    all_probs, all_labels, all_fore_pred, all_fore_true = [], [], [], []

    with torch.no_grad():
        for x_ts, x_ehr, y_cls, y_fore in loader:
            x_ts  = x_ts.to(DEVICE)
            x_ehr = x_ehr.to(DEVICE)
            prob, fore = model(x_ts, x_ehr)
            # Temperature scaling
            logit = torch.logit(prob.clamp(1e-6, 1 - 1e-6)) / temperature
            prob_cal = torch.sigmoid(logit)
            all_probs.extend(prob_cal.cpu().numpy().tolist())
            all_labels.extend(y_cls.numpy().tolist())
            all_fore_pred.extend(fore.cpu().numpy().tolist())
            all_fore_true.extend(y_fore.numpy().tolist())

    return (
        np.array(all_probs),
        np.array(all_labels),
        np.array(all_fore_pred),
        np.array(all_fore_true),
    )


def _enable_dropout(model: nn.Module):
    """Enable only Dropout layers while keeping everything else in eval mode."""
    model.eval()
    for m in model.modules():
        if type(m).__name__ == "Dropout":
            m.train()


def mc_dropout_probs(model: nn.Module, loader: DataLoader,
                     n_samples: int = N_MC) -> tuple:
    """Returns (mean_probs, lower_probs, upper_probs)."""
    samples = []
    for _ in range(n_samples):
        _enable_dropout(model)  # dropout on, rest in eval
        batch_probs = []
        with torch.no_grad():
            for x_ts, x_ehr, _, _ in loader:
                p, _ = model(x_ts.to(DEVICE), x_ehr.to(DEVICE))
                batch_probs.extend(p.cpu().numpy().tolist())
        samples.append(batch_probs)

    model.eval()
    arr = np.array(samples)   # (n_samples, N)
    return arr.mean(0), np.percentile(arr, 5, axis=0), np.percentile(arr, 95, axis=0)


def compute_cls_metrics(y_true: np.ndarray, y_prob: np.ndarray,
                        threshold: float = 0.5) -> dict:
    y_pred = (y_prob >= threshold).astype(int)
    cm = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = cm.ravel() if cm.shape == (2, 2) else (0, 0, 0, 0)
    spec = tn / (tn + fp) if (tn + fp) > 0 else 0.0
    return {
        "auroc":       round(float(roc_auc_score(y_true, y_prob)), 4),
        "auprc":       round(float(average_precision_score(y_true, y_prob)), 4),
        "precision":   round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall":      round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1":          round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "specificity": round(float(spec), 4),
        "ece":         round(ece(y_true, y_prob), 4),
        "confusion_matrix": {"tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn)},
    }


def compute_forecast_metrics(y_pred: np.ndarray, y_true: np.ndarray) -> dict:
    """
    y_pred: (N, 4) normalized [0,1] forecast outputs from model
    y_true: (N, 4) raw glucose mg/dL targets
    Denormalize y_pred to mg/dL before computing metrics.
    """
    GLUCOSE_MIN, GLUCOSE_MAX = 55.0, 400.0
    y_pred_mgdl = y_pred * (GLUCOSE_MAX - GLUCOSE_MIN) + GLUCOSE_MIN
    horizons = ["+30min", "+60min", "+90min", "+120min"]
    result = {}
    for i, h in enumerate(horizons):
        mae  = float(np.abs(y_pred_mgdl[:, i] - y_true[:, i]).mean())
        rmse = float(np.sqrt(np.mean((y_pred_mgdl[:, i] - y_true[:, i]) ** 2)))
        result[h] = {"mae": round(mae, 2), "rmse": round(rmse, 2)}
    return result


# ── Plots ──────────────────────────────────────────────────────────────────────

def plot_roc(models_data: dict):
    fig, ax = plt.subplots(figsize=(7, 6))
    for name, (y_true, y_prob) in models_data.items():
        fpr, tpr, _ = roc_curve(y_true, y_prob)
        auroc = roc_auc_score(y_true, y_prob)
        ax.plot(fpr, tpr, label=f"{name} (AUROC={auroc:.3f})")
    ax.plot([0, 1], [0, 1], "k--", lw=0.8)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("ROC Curves — Test Set")
    ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS_DIR, "roc_curve.png"), dpi=150)
    plt.close(fig)


def plot_calibration(y_true: np.ndarray, y_prob_raw: np.ndarray,
                     y_prob_cal: np.ndarray):
    n_bins = 15
    fig, ax = plt.subplots(figsize=(6, 5))

    for label, probs, color in [
        ("Uncalibrated", y_prob_raw, "steelblue"),
        ("Calibrated (Temp)", y_prob_cal, "tomato"),
    ]:
        bins = np.linspace(0, 1, n_bins + 1)
        bin_acc, bin_conf = [], []
        for i in range(n_bins):
            mask = (probs >= bins[i]) & (probs < bins[i + 1])
            if mask.sum() > 0:
                bin_acc.append(y_true[mask].mean())
                bin_conf.append(probs[mask].mean())
        ax.plot(bin_conf, bin_acc, "o-", label=label, color=color)

    ax.plot([0, 1], [0, 1], "k--", lw=0.8, label="Perfect calibration")
    ax.set_xlabel("Mean Predicted Probability")
    ax.set_ylabel("Fraction of Positives")
    ax.set_title("Calibration Curve (Reliability Diagram)")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS_DIR, "calibration_curve.png"), dpi=150)
    plt.close(fig)


def plot_confusion(cm_dict: dict, model_name: str):
    cm = np.array([
        [cm_dict["tn"], cm_dict["fp"]],
        [cm_dict["fn"], cm_dict["tp"]],
    ])
    fig, ax = plt.subplots(figsize=(4, 4))
    im = ax.imshow(cm, cmap="Blues")
    for i in range(2):
        for j in range(2):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black",
                    fontsize=14)
    ax.set_xticks([0, 1])
    ax.set_yticks([0, 1])
    ax.set_xticklabels(["Pred: No", "Pred: Yes"])
    ax.set_yticklabels(["True: No", "True: Yes"])
    ax.set_title(f"Confusion Matrix — {model_name}")
    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS_DIR, "confusion_matrix.png"), dpi=150)
    plt.close(fig)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    X_ts_te, X_ehr_te, y_te, yf_te = load_split("test")
    X_ts_vl, X_ehr_vl, y_vl, yf_vl = load_split("val")

    with open(os.path.join(PROC_DIR, "class_balance.json")) as f:
        cb = json.load(f)
    with open(os.path.join(RESULTS_DIR, "calibration_temp.json")) as f:
        T = json.load(f)["temperature"]

    print(f"Evaluating on test set: {len(y_te):,} windows")
    print(f"  Class balance: {cb['test']['n_positive']:,} pos / "
          f"{cb['test']['n_negative']:,} neg ({cb['test']['pos_rate']*100:.1f}% pos)")

    test_loader = make_loader(X_ts_te, X_ehr_te, y_te, yf_te)
    val_loader  = make_loader(X_ts_vl, X_ehr_vl, y_vl, yf_vl)

    ehr_dim = X_ehr_te.shape[1]
    ts_dim  = X_ts_te.shape[2]

    all_metrics = {
        "dataset_info": {
            "n_patients": 120,
            "simulation_days": 30,
            "cgm_interval_min": 5,
            "input_window_hours": 6,
            "label_horizon_hours": 2,
            "hyperglycaemia_threshold_mgdl": 180,
            "class_balance": cb,
        },
        "models": {},
    }

    roc_data = {}

    # ── Full Fusion Model ──────────────────────────────────────────────────────
    print("\n[1/5] Full Fusion Model ...")
    fusion = FusionModel(ehr_input_dim=ehr_dim, ts_input_dim=ts_dim, dropout=0.3)
    fusion.load_state_dict(torch.load(
        os.path.join(RESULTS_DIR, "fusion_model.pt"), map_location=DEVICE,
        weights_only=True))
    fusion = fusion.to(DEVICE)

    probs_raw, labels, fore_pred, fore_true = get_predictions_nn(fusion, test_loader, 1.0)
    probs_cal, labels, fore_pred_c, _       = get_predictions_nn(fusion, test_loader, T)

    # MC dropout on a subsample (5K windows) to keep CPU runtime reasonable
    mc_sub_idx = np.random.choice(len(X_ts_te), min(5000, len(X_ts_te)), replace=False)
    mc_loader  = make_loader(X_ts_te[mc_sub_idx], X_ehr_te[mc_sub_idx],
                             y_te[mc_sub_idx], yf_te[mc_sub_idx])
    mc_mean, mc_lo, mc_hi = mc_dropout_probs(fusion, mc_loader)
    labels_mc = y_te[mc_sub_idx]

    cls_metrics = compute_cls_metrics(labels, probs_cal)
    fore_metrics = compute_forecast_metrics(fore_pred_c, fore_true)

    interval_coverage = float(
        ((mc_lo <= labels_mc) & (labels_mc <= mc_hi)).mean()
    )

    all_metrics["models"]["fusion_full"] = {
        **cls_metrics,
        "forecast": fore_metrics,
        "mc_dropout_interval_coverage_90pct": round(interval_coverage, 4),
        "calibration_temperature": round(T, 4),
        "label": "Full Fusion (GRU + EHR)",
    }
    roc_data["Fusion (full)"] = (labels, probs_cal)
    plot_confusion(cls_metrics["confusion_matrix"], "Fusion (full)")
    print(f"  AUROC={cls_metrics['auroc']}  AUPRC={cls_metrics['auprc']}  "
          f"F1={cls_metrics['f1']}  ECE={cls_metrics['ece']}")

    # Calibration plot: compare raw vs calibrated
    plot_calibration(labels, probs_raw, probs_cal)

    # ── Ablation: Glucose Only ─────────────────────────────────────────────────
    print("\n[2/5] Ablation: Glucose Only ...")
    gluc_m = GlucoseOnlyModel(dropout=0.3).to(DEVICE)
    gluc_m.load_state_dict(torch.load(
        os.path.join(RESULTS_DIR, "ablation_glucose.pt"), map_location=DEVICE,
        weights_only=True))
    probs_g, labels_g, _, _ = get_predictions_nn(gluc_m, test_loader)
    abl_gluc = compute_cls_metrics(labels_g, probs_g)
    all_metrics["models"]["ablation_glucose_only"] = {
        **abl_gluc,
        "label": "GRU (glucose only)",
    }
    roc_data["GRU (glucose only)"] = (labels_g, probs_g)
    print(f"  AUROC={abl_gluc['auroc']}  AUPRC={abl_gluc['auprc']}  F1={abl_gluc['f1']}")

    # ── Ablation: Wearables, no EHR ────────────────────────────────────────────
    print("\n[3/5] Ablation: Wearables (no EHR) ...")
    wear_m = WearablesNoEHRModel(ts_input_dim=ts_dim, dropout=0.3).to(DEVICE)
    wear_m.load_state_dict(torch.load(
        os.path.join(RESULTS_DIR, "ablation_wearables.pt"), map_location=DEVICE,
        weights_only=True))
    probs_w, labels_w, _, _ = get_predictions_nn(wear_m, test_loader)
    abl_wear = compute_cls_metrics(labels_w, probs_w)
    all_metrics["models"]["ablation_wearables_no_ehr"] = {
        **abl_wear,
        "label": "GRU + Wearables (no EHR)",
    }
    roc_data["GRU + Wearables"] = (labels_w, probs_w)
    print(f"  AUROC={abl_wear['auroc']}  AUPRC={abl_wear['auprc']}  F1={abl_wear['f1']}")

    # ── XGBoost ────────────────────────────────────────────────────────────────
    print("\n[4/5] XGBoost baseline ...")
    with open(os.path.join(RESULTS_DIR, "xgboost.pkl"), "rb") as f:
        xgb = pickle.load(f)
    Xf_te = extract_features(X_ts_te, X_ehr_te)
    xgb_probs = xgb.predict_proba(Xf_te)[:, 1]
    xgb_metrics = compute_cls_metrics(y_te, xgb_probs)
    all_metrics["models"]["xgboost"] = {**xgb_metrics, "label": "XGBoost (tabular)"}
    roc_data["XGBoost"] = (y_te, xgb_probs)
    print(f"  AUROC={xgb_metrics['auroc']}  AUPRC={xgb_metrics['auprc']}  F1={xgb_metrics['f1']}")

    # ── Logistic Regression ────────────────────────────────────────────────────
    print("\n[5/5] Logistic Regression baseline ...")
    with open(os.path.join(RESULTS_DIR, "logreg.pkl"), "rb") as f:
        lr_model = pickle.load(f)
    lr_probs = lr_model.predict_proba(Xf_te)[:, 1]
    lr_metrics = compute_cls_metrics(y_te, lr_probs)
    all_metrics["models"]["logreg"] = {**lr_metrics, "label": "Logistic Regression"}
    roc_data["LogReg"] = (y_te, lr_probs)
    print(f"  AUROC={lr_metrics['auroc']}  AUPRC={lr_metrics['auprc']}  F1={lr_metrics['f1']}")

    # ── Ablation summary ───────────────────────────────────────────────────────
    ablation = []
    for key, label in [
        ("ablation_glucose_only",     "GRU (glucose only)"),
        ("ablation_wearables_no_ehr", "GRU + Wearables (no EHR)"),
        ("fusion_full",               "Full Fusion (GRU + EHR)"),
        ("xgboost",                   "XGBoost (tabular)"),
        ("logreg",                    "Logistic Regression"),
    ]:
        m = all_metrics["models"][key]
        ablation.append({
            "model": label,
            "auroc": m["auroc"],
            "auprc": m["auprc"],
            "f1":    m["f1"],
        })
    all_metrics["ablation_table"] = ablation

    # ── Honest note ────────────────────────────────────────────────────────────
    fusion_auroc = all_metrics["models"]["fusion_full"]["auroc"]
    xgb_auroc    = all_metrics["models"]["xgboost"]["auroc"]
    diff_pp = round((fusion_auroc - xgb_auroc) * 100, 2)
    all_metrics["honest_comparison"] = {
        "fusion_auroc":  fusion_auroc,
        "xgboost_auroc": xgb_auroc,
        "diff_percentage_points": diff_pp,
        "note": (
            f"Full fusion model {'outperforms' if diff_pp > 0 else 'underperforms vs.'} "
            f"XGBoost by {abs(diff_pp):.2f} percentage points on AUROC. "
            "On synthetic data, tree models can match or beat deep learning — this is expected."
        ),
    }

    # ── ROC plot ───────────────────────────────────────────────────────────────
    plot_roc(roc_data)

    # ── Save metrics ───────────────────────────────────────────────────────────
    out_path = os.path.join(RESULTS_DIR, "metrics.json")
    with open(out_path, "w") as f:
        json.dump(all_metrics, f, indent=2)

    print(f"\n[OK] Evaluation complete. Metrics -> {out_path}")
    print(f"     Plots -> {PLOTS_DIR}/")
    print(f"\n  Honest comparison: Fusion AUROC={fusion_auroc} vs "
          f"XGBoost AUROC={xgb_auroc} ({diff_pp:+.2f} pp)")


if __name__ == "__main__":
    main()
