"""
generate_cgm.py
---------------
Simulates 30-day CGM traces + wearable streams for every patient in ehr.csv
using the physiological glucose-insulin ODE in src/twin/glucose_model.py.

CGM MODEL (physiological Bergman / UVA-Padova-lite ODE):
    - Plasma glucose driven by meal absorption, hepatic production, insulin
      disposal (insulin-dependent + glucose-effectiveness), basal utilization.
    - Remote insulin action X(t) and plasma insulin I(t) kinetics.
    - Wearable/lifestyle signals modulate physiology each 5-min step:
        steps/activity  -> raises S_G (glucose effectiveness) & S_I (sensitivity)
        sleep quality   -> poor sleep lowers S_I
        stress (HRV)    -> raises hepatic EGP, lowers S_I
        carbs           -> enter Gut compartment, absorbed over ~60-90 min
        metformin       -> suppresses hepatic EGP
    - Plasma glucose -> interstitial CGM with ~10-min physiological lag +
      sensor noise.

WEARABLE STREAMS (rule-based, physiologically-plausible daily patterns):
    - Heart Rate: baseline ~65, higher by day/activity, lower at night.
    - HRV: baseline ~45, lower during hyperglycaemia/stress.
    - Steps: 0 overnight, activity bursts 08-09 & 17-18.
    - Sleep state: rule-based schedule 22:00-07:00.
    - Carbs: logged at meal events (breakfast/lunch/dinner/snack).
    - Med taken: once daily at 08:00.

OUTPUT: data/raw/cgm_<patient_id>.parquet  (one file per patient)
All values are synthetic / physiologically inspired. Not for clinical use.
"""

import os
import json
import numpy as np
import pandas as pd
from tqdm import tqdm

# Import the physiological twin core
from src.twin.glucose_model import (
    SEED as TWIN_SEED,
    WearableInputs,
    simulate_patient_trace,
    trace_to_dataframe,
)

# ── Reproducibility ────────────────────────────────────────────────────────────
SEED = 42
RNG = np.random.default_rng(SEED)

# ── Config ─────────────────────────────────────────────────────────────────────
DAYS = 30
INTERVAL_MIN = 5
STEPS_PER_DAY = 24 * 60 // INTERVAL_MIN   # 288
N_STEPS = DAYS * STEPS_PER_DAY             # 8640

BASE = os.path.join(os.path.dirname(__file__), "../..")
RAW_DIR = os.path.join(BASE, "data/raw")
EHR_PATH = os.path.join(RAW_DIR, "ehr.csv")
PATIENT_IDS_PATH = os.path.join(RAW_DIR, "patient_ids.json")

# ── Medication glucose-dampening (kept for reference / downstream) ─────────────
MED_DAMPEN = {
    "Metformin": 0.85,
    "Glipizide": 0.75,
    "Insulin_basal": 0.60,
    "Sitagliptin": 0.80,
    "None": 1.00,
}

# ── Meal schedule (hour-of-day, mean carbs, std) ───────────────────────────────
MEALS = [
    {"hour": 7.5,  "carbs_mean": 50, "carbs_std": 15},   # breakfast
    {"hour": 12.5, "carbs_mean": 70, "carbs_std": 20},   # lunch
    {"hour": 15.5, "carbs_mean": 25, "carbs_std": 10},   # snack (50% chance)
    {"hour": 19.0, "carbs_mean": 65, "carbs_std": 20},   # dinner
]
SNACK_PROB = 0.50


# ── Wearable-stream builders ───────────────────────────────────────────────────

def _build_steps(rng: np.random.Generator) -> np.ndarray:
    """Steps per 5-min step: 0 overnight, bursts morning & evening."""
    steps = np.zeros(N_STEPS)
    for day in range(DAYS):
        off = day * STEPS_PER_DAY
        # Morning activity burst 08:00-09:00 (12 steps)
        m0 = off + int(8.0 * 60 / INTERVAL_MIN)
        m1 = off + int(9.0 * 60 / INTERVAL_MIN)
        steps[m0:m1] = rng.integers(40, 120, size=m1 - m0)
        # Evening activity burst 17:00-18:00
        e0 = off + int(17.0 * 60 / INTERVAL_MIN)
        e1 = off + int(18.0 * 60 / INTERVAL_MIN)
        steps[e0:e1] = rng.integers(30, 100, size=e1 - e0)
        # Light background movement during waking hours 07:00-22:00
        w0 = off + int(7.0 * 60 / INTERVAL_MIN)
        w1 = off + int(22.0 * 60 / INTERVAL_MIN)
        steps[w0:w1] += rng.integers(0, 15, size=w1 - w0)
    return steps


def _build_sleep(rng: np.random.Generator) -> np.ndarray:
    """Sleep state per step: 0=awake,1=light,2=deep,3=REM. Schedule 22:00-07:00."""
    sleep = np.zeros(N_STEPS, dtype=int)
    for day in range(DAYS):
        off = day * STEPS_PER_DAY
        s0 = off + int(22.0 * 60 / INTERVAL_MIN)   # 22:00 bedtime
        s1 = off + STEPS_PER_DAY                    # to midnight
        sleep[s0:s1] = rng.integers(1, 4, size=s1 - s0)
        n0 = off                                     # midnight
        n1 = off + int(7.0 * 60 / INTERVAL_MIN)     # 07:00 wake
        sleep[n0:n1] = rng.integers(1, 4, size=n1 - n0)
    return sleep


def _build_meal_events(rng: np.random.Generator) -> np.ndarray:
    """Carbs (g) logged at each 5-min step from scheduled meals."""
    carbs = np.zeros(N_STEPS)
    for day in range(DAYS):
        off = day * STEPS_PER_DAY
        for meal in MEALS:
            if meal["carbs_mean"] == 25 and rng.random() > SNACK_PROB:
                continue
            meal_hour = meal["hour"] + rng.normal(0, 0.5)   # +/-30 min jitter
            meal_step = int(off + meal_hour * 60 / INTERVAL_MIN)
            meal_step = np.clip(meal_step, off, off + STEPS_PER_DAY - 1)
            carbs_g = max(0.0, rng.normal(meal["carbs_mean"], meal["carbs_std"]))
            carbs[meal_step] = carbs_g
    return carbs


def _build_medication() -> np.ndarray:
    """Once-daily metformin dose at 08:00."""
    med = np.zeros(N_STEPS, dtype=int)
    for day in range(DAYS):
        step = day * STEPS_PER_DAY + int(8.0 * 60 / INTERVAL_MIN)
        med[step] = 1
    return med


def _build_hr_hrv_stress(glucose: np.ndarray, steps: np.ndarray,
                         sleep: np.ndarray, rng: np.random.Generator):
    """Heart rate, HRV, stress derived from glucose, activity, sleep, time."""
    n = len(glucose)
    hod = (np.arange(n) % STEPS_PER_DAY) * INTERVAL_MIN / 60.0  # hour of day

    # Stress: higher by day, lower at night; spikes with hyperglycaemia
    stress = 0.2 + 0.3 * ((hod >= 7) & (hod <= 22)).astype(float)
    stress += 0.2 * (glucose > 160).astype(float)
    stress = np.clip(stress + rng.normal(0, 0.08, n), 0.0, 1.0)

    # Heart rate: ~65 at rest, +10 by day, +15 with activity
    hr = 65.0 + 10.0 * ((hod >= 7) & (hod <= 22)).astype(float)
    hr += 0.15 * steps
    hr += 0.05 * (glucose - 100).clip(0)
    hr = hr + rng.normal(0, 4, n)
    hr = np.clip(hr, 50, 130)

    # HRV: ~45 at rest, lower with stress/hyperglycaemia
    hrv = 45.0 - 8.0 * stress - 0.06 * (glucose - 100).clip(0)
    hrv = hrv + rng.normal(0, 4, n)
    hrv = np.clip(hrv, 20, 90)

    return hr, hrv, stress


def build_wearables_for_patient(pid: str, mean_glucose: float,
                                medication: str, rng: np.random.Generator) -> WearableInputs:
    """Build the full WearableInputs array set for one patient."""
    steps = _build_steps(rng)
    sleep = _build_sleep(rng)
    carbs = _build_meal_events(rng)
    med = _build_medication()

    # We need glucose to derive HR/HRV/stress, but glucose depends on wearables.
    # Use a first-pass glucose from the ODE with neutral wearables, then refine.
    neutral = WearableInputs(
        steps_5min=np.zeros(N_STEPS),
        sleep_state=sleep,
        carbs_g=carbs,
        med_taken=med,
        stress=np.full(N_STEPS, 0.3),
        heart_rate=np.full(N_STEPS, 72.0),
    )
    first_pass = simulate_patient_trace(pid, _timestamps(), neutral, rng=rng)
    glucose = first_pass.glucose_plasma

    hr, hrv, stress = _build_hr_hrv_stress(glucose, steps, sleep, rng)

    return WearableInputs(
        steps_5min=steps,
        sleep_state=sleep,
        carbs_g=carbs,
        med_taken=med,
        stress=stress,
        heart_rate=hr,
    )


def _timestamps() -> np.ndarray:
    return pd.date_range("2026-01-01", periods=N_STEPS, freq="5min").values


def simulate_and_save(pid: str, mean_glucose: float, medication: str,
                      rng: np.random.Generator) -> dict:
    """Simulate one patient and write cgm_<pid>.parquet. Returns summary stats."""
    p_seed = int(pid[1:]) * 1000 + SEED
    p_rng = np.random.default_rng(p_seed)

    wearables = build_wearables_for_patient(pid, mean_glucose, medication, p_rng)
    timestamps = _timestamps()

    trace = simulate_patient_trace(pid, timestamps, wearables, rng=p_rng)
    df = trace_to_dataframe(trace)

    out_path = os.path.join(RAW_DIR, "cgm_%s.parquet" % pid)
    df.to_parquet(out_path, index=False)

    return {
        "patient_id": pid,
        "mean_glucose": float(round(df["glucose_mgdl"].mean(), 1)),
        "pct_above_180": float(round((df["glucose_mgdl"] > 180).mean() * 100, 3)),
        "pct_below_70": float(round((df["glucose_mgdl"] < 70).mean() * 100, 3)),
        "n_steps": int(len(df)),
    }


def main():
    os.makedirs(RAW_DIR, exist_ok=True)

    ehr = pd.read_csv(EHR_PATH)
    print("Simulating CGM for %d patients over %d days (5-min) via physiological ODE …"
          % (len(ehr), DAYS))

    patient_rng = np.random.default_rng(SEED + 1)
    all_summaries = []
    for _, row in tqdm(ehr.iterrows(), total=len(ehr)):
        pid = row["patient_id"]
        mean_glucose = row["_mean_glucose_seed"]
        medication = row["medication"]
        # Guard against "None" medication read as NaN
        if pd.isna(medication):
            medication = "None"
        summary = simulate_and_save(pid, mean_glucose, medication, patient_rng)
        all_summaries.append(summary)

    summary_df = pd.DataFrame(all_summaries)
    summary_df.to_csv(os.path.join(RAW_DIR, "cgm_summary.csv"), index=False)

    print("\n[OK] CGM simulation complete.")
    print("   Mean glucose across all patients: %.1f mg/dL" % summary_df["mean_glucose"].mean())
    print("   Avg time above 180: %.1f %%" % summary_df["pct_above_180"].mean())
    print("   Avg time below 70:  %.1f %%" % summary_df["pct_below_70"].mean())
    print("   Files -> %s/cgm_P*.parquet" % RAW_DIR)


if __name__ == "__main__":
    main()
