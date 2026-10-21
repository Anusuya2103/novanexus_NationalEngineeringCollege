"""
baselines.py
------------
Logistic Regression and XGBoost baselines trained on hand-crafted
window features (no time-series encoding — tabular only).

Hand-crafted features per window (applied to each of the 7 channels):
  - last value
  - mean
  - std
  - min / max
  - linear slope (polyfit deg=1)
  - value 6 steps ago (30-min lookback)
  - time-since-last-meal (steps since last nonzero carbs)
  - recent spike rate (fraction of steps with glucose > 160)

Final feature vector: ~65 features (not all channels need every stat).
"""

import os
import pickle
import json
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier


# ── Feature engineering ────────────────────────────────────────────────────────

CHANNEL_NAMES = [
    "glucose", "heart_rate", "hrv", "steps", "sleep", "carbs", "med_taken"
]


def _slope(arr: np.ndarray) -> float:
    """Least-squares slope of a 1-D array."""
    x = np.arange(len(arr))
    if arr.std() == 0:
        return 0.0
    coeffs = np.polyfit(x, arr, 1)
    return float(coeffs[0])


def _time_since_last_meal(carbs_window: np.ndarray) -> int:
    """Steps since last non-zero carbs entry in the window (24 if none)."""
    nonzero = np.where(carbs_window > 0)[0]
    if len(nonzero) == 0:
        return 24
    return int(24 - nonzero[-1])


def extract_features(X_ts: np.ndarray, X_ehr: np.ndarray) -> np.ndarray:
    """
    Convert (N, 24, 7) time-series + (N, 12) EHR into (N, D) tabular features.

    Args:
        X_ts  : (N, 24, 7) — scaled time-series windows
        X_ehr : (N, 12)    — scaled EHR features

    Returns:
        features : (N, D) float32
    """
    N = X_ts.shape[0]
    feat_list = []

    for i in range(N):
        w = X_ts[i]      # (24, 7)
        row = []

        for c in range(7):
            ch = w[:, c]
            row.extend([
                ch[-1],          # last value
                ch.mean(),       # mean
                ch.std(),        # std
                ch.min(),        # min
                ch.max(),        # max
                _slope(ch),      # linear trend
                ch[-6] if len(ch) >= 6 else ch[0],  # 30-min ago
            ])

        # Glucose-specific extras (channel 0)
        gluc = w[:, 0]
        row.append(float((gluc > 1.0).mean()))   # fraction above ~160 (scaled)
        row.append(_time_since_last_meal(w[:, 5]))  # time since meal (carbs ch=5)

        # Append EHR
        row.extend(X_ehr[i].tolist())

        feat_list.append(row)

    return np.array(feat_list, dtype=np.float32)


# ── Baseline models ────────────────────────────────────────────────────────────

def build_logreg() -> Pipeline:
    return Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(
            max_iter=1000,
            C=1.0,
            class_weight="balanced",
            solver="lbfgs",
            n_jobs=-1,
        )),
    ])


def build_xgboost(pos_weight: float = 1.0) -> XGBClassifier:
    return XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=pos_weight,
        eval_metric="logloss",
        use_label_encoder=False,
        n_jobs=-1,
        random_state=42,
        tree_method="hist",
    )


def train_baselines(
    X_ts_train, X_ehr_train, y_train,
    X_ts_val,   X_ehr_val,   y_val,
    pos_weight: float,
    save_dir: str,
) -> dict:
    """
    Train both baselines, save them, return val AUROC.
    """
    from sklearn.metrics import roc_auc_score, average_precision_score

    print("  Extracting tabular features for baselines ...")
    Xf_train = extract_features(X_ts_train, X_ehr_train)
    Xf_val   = extract_features(X_ts_val,   X_ehr_val)

    results = {}

    # Logistic Regression
    print("  Training Logistic Regression ...")
    lr = build_logreg()
    lr.fit(Xf_train, y_train)
    lr_probs = lr.predict_proba(Xf_val)[:, 1]
    results["logreg"] = {
        "auroc": float(roc_auc_score(y_val, lr_probs)),
        "auprc": float(average_precision_score(y_val, lr_probs)),
    }
    with open(os.path.join(save_dir, "logreg.pkl"), "wb") as f:
        pickle.dump(lr, f)
    print(f"    LogReg AUROC={results['logreg']['auroc']:.4f}  "
          f"AUPRC={results['logreg']['auprc']:.4f}")

    # XGBoost
    print("  Training XGBoost ...")
    xgb = build_xgboost(pos_weight)
    xgb.fit(
        Xf_train, y_train,
        eval_set=[(Xf_val, y_val)],
        verbose=False,
    )
    xgb_probs = xgb.predict_proba(Xf_val)[:, 1]
    results["xgboost"] = {
        "auroc": float(roc_auc_score(y_val, xgb_probs)),
        "auprc": float(average_precision_score(y_val, xgb_probs)),
    }
    with open(os.path.join(save_dir, "xgboost.pkl"), "wb") as f:
        pickle.dump(xgb, f)
    print(f"    XGBoost AUROC={results['xgboost']['auroc']:.4f}  "
          f"AUPRC={results['xgboost']['auprc']:.4f}")

    return results
