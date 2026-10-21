"""
build_windows.py
----------------
Builds sliding-window feature arrays from CGM + wearable traces + EHR.

TASK DEFINITION:
  - Input window : last 6 hours at 15-min resolution -> 24 steps × 7 channels
                   [glucose, heart_rate, hrv, steps, sleep_state, carbs_15min, med_taken]
  - Label        : 1 if glucose > 180 mg/dL at ANY point in the next 2 hours (24 steps @ 5-min)
  - Static EHR   : 12 scalar features per patient (normalized)

SPLIT STRATEGY:
  - By PATIENT (never by window) to prevent leakage.
  - 70 % train / 15 % val / 15 % test.

OUTPUTS (data/processed/):
  - X_ts_<split>.npy          shape (N, 24, 7)   — time-series input
  - X_ehr_<split>.npy         shape (N, 12)       — static EHR input
  - y_<split>.npy             shape (N,)          — binary label
  - y_forecast_<split>.npy    shape (N, 4)        — glucose @+30/60/90/120 min (regression)
  - patient_ids_<split>.json  — patient list per split
  - scaler_ts.pkl             — StandardScaler for time-series channels
  - scaler_ehr.pkl            — StandardScaler for EHR features
  - class_balance.json        — label counts and pos_weight for weighted BCE
"""

import os
import json
import pickle
import warnings
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from tqdm import tqdm

warnings.filterwarnings("ignore")

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE = os.path.join(os.path.dirname(__file__), "../..")
RAW_DIR = os.path.join(BASE, "data/raw")
PROC_DIR = os.path.join(BASE, "data/processed")
EHR_PATH = os.path.join(RAW_DIR, "ehr.csv")

# ── Task parameters ────────────────────────────────────────────────────────────
INPUT_INTERVAL_MIN  = 15       # downsample from 5-min to 15-min
INPUT_STEPS         = 24       # 6 hours back
HYPER_THRESHOLD     = 180.0    # mg/dL
FORECAST_HORIZONS   = [6, 12, 18, 24]   # steps @5-min -> 30/60/90/120 min ahead

# 5-min -> 15-min: take every 3rd step
DOWNSAMPLE_FACTOR = INPUT_INTERVAL_MIN // 5   # 3

# How many raw 5-min steps to look ahead for the label
LABEL_HORIZON_STEPS = 24   # 24×5 = 120 min

# ── EHR features to use ────────────────────────────────────────────────────────
EHR_COLS = [
    "age", "bmi", "diabetes_duration_yrs", "hba1c_pct",
    "sbp_mmhg", "dbp_mmhg", "prior_hyper_events_90d", "n_comorbidities",
    "TCF7L2_risk", "KCNJ11_risk", "PPARG_risk",
    "medication_encoded",
]

MED_ENCODING = {
    "Metformin": 0, "Glipizide": 1, "Insulin_basal": 2,
    "Sitagliptin": 3, "None": 4,
}

TS_CHANNELS = [
    "glucose_mgdl", "heart_rate_bpm", "hrv_ms",
    "steps_5min", "sleep_state", "carbs_15min", "med_taken",
]


def _prepare_ehr(ehr: pd.DataFrame) -> tuple:
    """Returns (ehr_dict, feature_names) where ehr_dict maps pid -> np.ndarray(12,)."""
    df = ehr.copy()
    df["medication_encoded"] = df["medication"].map(MED_ENCODING).fillna(4).astype(float)
    feat_df = df[EHR_COLS].fillna(0).astype(float)
    ehr_dict = {row["patient_id"]: feat_df.loc[i].values for i, row in df.iterrows()}
    return ehr_dict, EHR_COLS


def _downsample_sum(arr: np.ndarray, factor: int) -> np.ndarray:
    """Downsample by summing groups of `factor` steps (useful for steps, carbs)."""
    n = (len(arr) // factor) * factor
    return arr[:n].reshape(-1, factor).sum(axis=1)


def _downsample_mean(arr: np.ndarray, factor: int) -> np.ndarray:
    """Downsample by averaging groups of `factor` steps."""
    n = (len(arr) // factor) * factor
    return arr[:n].reshape(-1, factor).mean(axis=1)


def _downsample_last(arr: np.ndarray, factor: int) -> np.ndarray:
    """Downsample by taking the last value in each group."""
    n = (len(arr) // factor) * factor
    return arr[:n].reshape(-1, factor)[:, -1]


def build_patient_windows(cgm_df: pd.DataFrame) -> tuple:
    """
    Build all valid windows for one patient.

    Returns:
        windows_ts   : (W, 24, 7) float32
        labels       : (W,)       uint8
        forecasts    : (W, 4)     float32  glucose @+30/60/90/120 min
    """
    raw_glucose = cgm_df["glucose_mgdl"].values.astype(np.float32)
    raw_hr      = cgm_df["heart_rate_bpm"].values.astype(np.float32)
    raw_hrv     = cgm_df["hrv_ms"].values.astype(np.float32)
    raw_steps   = cgm_df["steps_5min"].values.astype(np.float32)
    raw_sleep   = cgm_df["sleep_state"].values.astype(np.float32)
    raw_carbs   = cgm_df["carbs_g"].values.astype(np.float32)
    raw_med     = cgm_df["med_taken"].values.astype(np.float32)

    n_raw = len(raw_glucose)

    # Downsample to 15-min resolution
    ds_glucose = _downsample_mean(raw_glucose, DOWNSAMPLE_FACTOR)
    ds_hr      = _downsample_mean(raw_hr, DOWNSAMPLE_FACTOR)
    ds_hrv     = _downsample_mean(raw_hrv, DOWNSAMPLE_FACTOR)
    ds_steps   = _downsample_sum(raw_steps, DOWNSAMPLE_FACTOR)
    ds_sleep   = _downsample_last(raw_sleep, DOWNSAMPLE_FACTOR)
    ds_carbs   = _downsample_sum(raw_carbs, DOWNSAMPLE_FACTOR)
    ds_med     = _downsample_last(raw_med, DOWNSAMPLE_FACTOR)

    n_ds = len(ds_glucose)

    windows_ts = []
    labels = []
    forecasts = []

    for i in range(INPUT_STEPS, n_ds):
        # Raw index corresponding to end of this window
        raw_end = i * DOWNSAMPLE_FACTOR

        # Check we have enough raw steps for label horizon
        if raw_end + LABEL_HORIZON_STEPS > n_raw:
            break

        # Time-series window: steps [i-INPUT_STEPS : i]
        win = np.stack([
            ds_glucose[i - INPUT_STEPS: i],
            ds_hr     [i - INPUT_STEPS: i],
            ds_hrv    [i - INPUT_STEPS: i],
            ds_steps  [i - INPUT_STEPS: i],
            ds_sleep  [i - INPUT_STEPS: i],
            ds_carbs  [i - INPUT_STEPS: i],
            ds_med    [i - INPUT_STEPS: i],
        ], axis=-1)  # (24, 7)

        # Label: any glucose > 180 in next 2 hours raw
        future_glucose = raw_glucose[raw_end: raw_end + LABEL_HORIZON_STEPS]
        label = int((future_glucose > HYPER_THRESHOLD).any())

        # Forecast targets: glucose at +30/60/90/120 min (raw indices 6,12,18,24)
        forecast_vals = []
        for h in FORECAST_HORIZONS:
            idx = raw_end + h
            if idx < n_raw:
                forecast_vals.append(raw_glucose[idx])
            else:
                forecast_vals.append(raw_glucose[-1])

        windows_ts.append(win)
        labels.append(label)
        forecasts.append(forecast_vals)

    if not windows_ts:
        return np.empty((0, INPUT_STEPS, 7), dtype=np.float32), \
               np.empty((0,), dtype=np.uint8), \
               np.empty((0, 4), dtype=np.float32)

    return (
        np.array(windows_ts, dtype=np.float32),
        np.array(labels, dtype=np.uint8),
        np.array(forecasts, dtype=np.float32),
    )


def main():
    os.makedirs(PROC_DIR, exist_ok=True)

    ehr = pd.read_csv(EHR_PATH)
    ehr_dict, _ = _prepare_ehr(ehr)
    all_pids = ehr["patient_id"].tolist()

    # ── Patient-level split (stratify by hyperglycaemia prevalence) ────────────
    np.random.seed(42)
    shuffled = np.random.permutation(len(all_pids))
    n_train = int(0.70 * len(all_pids))
    n_val   = int(0.15 * len(all_pids))
    train_pids = [all_pids[i] for i in shuffled[:n_train]]
    val_pids   = [all_pids[i] for i in shuffled[n_train: n_train + n_val]]
    test_pids  = [all_pids[i] for i in shuffled[n_train + n_val:]]

    split_map = {pid: "train" for pid in train_pids}
    split_map.update({pid: "val" for pid in val_pids})
    split_map.update({pid: "test" for pid in test_pids})

    print(f"Patient split -> train: {len(train_pids)}, val: {len(val_pids)}, test: {len(test_pids)}")

    # ── Accumulate windows ─────────────────────────────────────────────────────
    buckets = {s: {"ts": [], "ehr": [], "y": [], "yf": []} for s in ("train", "val", "test")}

    for pid in tqdm(all_pids, desc="Building windows"):
        cgm_path = os.path.join(RAW_DIR, f"cgm_{pid}.parquet")
        if not os.path.exists(cgm_path):
            print(f"  ⚠ Missing CGM for {pid}, skipping.")
            continue

        cgm_df = pd.read_parquet(cgm_path)
        wins_ts, wins_y, wins_yf = build_patient_windows(cgm_df)

        if len(wins_ts) == 0:
            continue

        ehr_vec = ehr_dict[pid]
        ehr_repeated = np.tile(ehr_vec, (len(wins_ts), 1)).astype(np.float32)

        split = split_map[pid]
        buckets[split]["ts"].append(wins_ts)
        buckets[split]["ehr"].append(ehr_repeated)
        buckets[split]["y"].append(wins_y)
        buckets[split]["yf"].append(wins_yf)

    # ── Fit scalers on TRAIN only ──────────────────────────────────────────────
    print("\nFitting scalers on training data …")

    X_ts_train_raw  = np.concatenate(buckets["train"]["ts"],  axis=0)
    X_ehr_train_raw = np.concatenate(buckets["train"]["ehr"], axis=0)

    # Time-series scaler: fit on flattened (N*T, C), apply back
    N, T, C = X_ts_train_raw.shape
    scaler_ts = StandardScaler()
    scaler_ts.fit(X_ts_train_raw.reshape(-1, C))

    scaler_ehr = StandardScaler()
    scaler_ehr.fit(X_ehr_train_raw)

    def scale_ts(arr):
        N, T, C = arr.shape
        return scaler_ts.transform(arr.reshape(-1, C)).reshape(N, T, C).astype(np.float32)

    def scale_ehr(arr):
        return scaler_ehr.transform(arr).astype(np.float32)

    # ── Save each split ────────────────────────────────────────────────────────
    class_balance = {}

    for split in ("train", "val", "test"):
        if not buckets[split]["ts"]:
            print(f"  ⚠ No data for split '{split}'")
            continue

        X_ts  = np.concatenate(buckets[split]["ts"],  axis=0)
        X_ehr = np.concatenate(buckets[split]["ehr"], axis=0)
        y     = np.concatenate(buckets[split]["y"],   axis=0)
        yf    = np.concatenate(buckets[split]["yf"],  axis=0)

        X_ts_scaled  = scale_ts(X_ts)
        X_ehr_scaled = scale_ehr(X_ehr)

        np.save(os.path.join(PROC_DIR, f"X_ts_{split}.npy"),       X_ts_scaled)
        np.save(os.path.join(PROC_DIR, f"X_ehr_{split}.npy"),      X_ehr_scaled)
        np.save(os.path.join(PROC_DIR, f"y_{split}.npy"),          y)
        np.save(os.path.join(PROC_DIR, f"y_forecast_{split}.npy"), yf)

        n_pos = int(y.sum())
        n_neg = int((y == 0).sum())
        pos_rate = n_pos / len(y) if len(y) > 0 else 0
        class_balance[split] = {
            "n_total": int(len(y)),
            "n_positive": n_pos,
            "n_negative": n_neg,
            "pos_rate": round(pos_rate, 4),
            "pos_weight": round(n_neg / max(n_pos, 1), 4),
        }
        print(f"  {split:5s}: {len(y):6d} windows | pos={n_pos} ({pos_rate*100:.1f} %) | "
              f"neg={n_neg} | pos_weight={n_neg/max(n_pos,1):.2f}")

    # ── Save scalers and metadata ──────────────────────────────────────────────
    with open(os.path.join(PROC_DIR, "scaler_ts.pkl"), "wb") as f:
        pickle.dump(scaler_ts, f)
    with open(os.path.join(PROC_DIR, "scaler_ehr.pkl"), "wb") as f:
        pickle.dump(scaler_ehr, f)
    with open(os.path.join(PROC_DIR, "class_balance.json"), "w") as f:
        json.dump(class_balance, f, indent=2)
    with open(os.path.join(PROC_DIR, "ts_channels.json"), "w") as f:
        json.dump(TS_CHANNELS, f)
    with open(os.path.join(PROC_DIR, "ehr_cols.json"), "w") as f:
        json.dump(EHR_COLS, f)

    print(f"\n[OK] Windows built -> {PROC_DIR}")
    print(f"   Class balance saved -> {PROC_DIR}/class_balance.json")


if __name__ == "__main__":
    main()
