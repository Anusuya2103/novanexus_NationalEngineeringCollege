"""
generate_ehr.py
---------------
Generates synthetic EHR (Electronic Health Record) static profiles for 500
virtual Type 2 Diabetes patients (P0001-P0500).

SCALE: 500 patients following a Synthea-style T2D + hypertension cohort with
Indian demographic & clinical distributions.

INDIAN CLINICAL CONVENTIONS
    - Asian-Indian BMI cutoffs (WHO): <18.5 underweight, 18.5-22.9 normal,
      23.0-24.9 overweight, >=25.0 obese (used alongside WHO standard cutoffs).
    - Earlier T2D onset in South Asians (mean age ~45-55).
    - Higher hypertension & dyslipidemia prevalence.
    - Genetic risk alleles: TCF7L2, KCNJ11, PPARG (South-Asian enriched).

DATA SOURCE: Entirely procedurally generated. No real patient data.
PAIRING NOTE: HbA1c and BMI are seeded from each patient's simulated long-run
mean glucose (written by generate_cgm.py) so the EHR vector is physiologically
consistent with their CGM trace. If CGM has not been generated yet, reasonable
population distributions are used and later overwritten by build_windows.py.

LICENSE: MIT - synthetic data only, DPDP/HIPAA safe.
"""

import json
import os
import sys
from typing import Optional

import numpy as np
import pandas as pd

# ── Reproducibility ────────────────────────────────────────────────────────────
SEED = 42
RNG = np.random.default_rng(SEED)

N_PATIENTS = 500
OUT_PATH = os.path.join(os.path.dirname(__file__), "../../data/raw/ehr.csv")
PATIENT_IDS_PATH = os.path.join(os.path.dirname(__file__), "../../data/raw/patient_ids.json")

# ── Medication list ─────────────────────────────────────────────────────────────
MEDICATIONS = ["Metformin", "Glipizide", "Insulin_basal", "Sitagliptin", "None"]
MED_WEIGHTS = [0.45, 0.20, 0.18, 0.10, 0.07]

# ── Comorbidity list (Indian T2D: hypertension very prevalent) ──────────────────
COMORBIDITIES = ["hypertension", "dyslipidemia", "CKD_stage2", "NAFLD", "neuropathy", "retinopathy"]

# ── Synthetic genetic risk flags (South-Asian enriched, fictional markers) ──────
GENETIC_FLAGS = ["TCF7L2_risk", "KCNJ11_risk", "PPARG_risk"]

# ── WHO BMI classifications ────────────────────────────────────────────────────


def _bmi_category_asian_indian(bmi: float) -> str:
    """WHO Asian-Indian BMI classification."""
    if bmi < 18.5:
        return "underweight"
    if bmi < 23.0:
        return "normal"
    if bmi < 25.0:
        return "overweight"
    return "obese"


def _bmi_category_who(bmi: float) -> str:
    """WHO standard (international) BMI classification."""
    if bmi < 18.5:
        return "underweight"
    if bmi < 25.0:
        return "normal"
    if bmi < 30.0:
        return "overweight"
    return "obese"


# ── Curated archetype patients (P0001-P0005) shown at top of the selector ──────
ARCHETYPES = [
    {
        "patient_id": "P0001", "age": 58, "sex": "M", "diabetes_duration_yrs": 8,
        "bmi": 27.4, "hba1c_pct": 7.2, "sbp_mmhg": 132, "dbp_mmhg": 84,
        "medication": "Metformin", "prior_hyper_events_90d": 2, "n_comorbidities": 1,
        "comorbid_hypertension": 1, "comorbid_dyslipidemia": 0, "comorbid_CKD_stage2": 0,
        "comorbid_NAFLD": 0, "comorbid_neuropathy": 0, "comorbid_retinopathy": 0,
        "TCF7L2_risk": 1, "KCNJ11_risk": 0, "PPARG_risk": 0,
        "_mean_glucose_seed": 145.0, "_archetype": "Stable T2D",
    },
    {
        "patient_id": "P0002", "age": 52, "sex": "F", "diabetes_duration_yrs": 5,
        "bmi": 29.1, "hba1c_pct": 8.1, "sbp_mmhg": 138, "dbp_mmhg": 88,
        "medication": "Metformin", "prior_hyper_events_90d": 5, "n_comorbidities": 1,
        "comorbid_hypertension": 0, "comorbid_dyslipidemia": 1, "comorbid_CKD_stage2": 0,
        "comorbid_NAFLD": 0, "comorbid_neuropathy": 0, "comorbid_retinopathy": 0,
        "TCF7L2_risk": 1, "KCNJ11_risk": 1, "PPARG_risk": 0,
        "_mean_glucose_seed": 172.0, "_archetype": "Borderline Post-Meal Spiker",
    },
    {
        "patient_id": "P0003", "age": 65, "sex": "M", "diabetes_duration_yrs": 15,
        "bmi": 31.8, "hba1c_pct": 9.4, "sbp_mmhg": 152, "dbp_mmhg": 94,
        "medication": "Insulin_basal", "prior_hyper_events_90d": 12, "n_comorbidities": 3,
        "comorbid_hypertension": 1, "comorbid_dyslipidemia": 1, "comorbid_CKD_stage2": 1,
        "comorbid_NAFLD": 0, "comorbid_neuropathy": 0, "comorbid_retinopathy": 1,
        "TCF7L2_risk": 1, "KCNJ11_risk": 1, "PPARG_risk": 1,
        "_mean_glucose_seed": 205.0, "_archetype": "High-Risk Poorly Controlled",
    },
    {
        "patient_id": "P0004", "age": 61, "sex": "F", "diabetes_duration_yrs": 10,
        "bmi": 26.9, "hba1c_pct": 7.9, "sbp_mmhg": 158, "dbp_mmhg": 96,
        "medication": "Glipizide", "prior_hyper_events_90d": 3, "n_comorbidities": 2,
        "comorbid_hypertension": 1, "comorbid_dyslipidemia": 1, "comorbid_CKD_stage2": 0,
        "comorbid_NAFLD": 1, "comorbid_neuropathy": 0, "comorbid_retinopathy": 0,
        "TCF7L2_risk": 0, "KCNJ11_risk": 0, "PPARG_risk": 1,
        "_mean_glucose_seed": 168.0, "_archetype": "Hypertensive + CKD Comorbid",
    },
    {
        "patient_id": "P0005", "age": 38, "sex": "M", "diabetes_duration_yrs": 2,
        "bmi": 24.3, "hba1c_pct": 6.8, "sbp_mmhg": 122, "dbp_mmhg": 78,
        "medication": "None", "prior_hyper_events_90d": 0, "n_comorbidities": 0,
        "comorbid_hypertension": 0, "comorbid_dyslipidemia": 0, "comorbid_CKD_stage2": 0,
        "comorbid_NAFLD": 0, "comorbid_neuropathy": 0, "comorbid_retinopathy": 0,
        "TCF7L2_risk": 0, "KCNJ11_risk": 0, "PPARG_risk": 0,
        "_mean_glucose_seed": 128.0, "_archetype": "Young Early-Onset T2D",
    },
]


def _glucose_to_hba1c(mean_glucose_mgdl: float) -> float:
    """
    Approximate HbA1c from mean glucose using the ADAG formula:
    eAG (mg/dL) = 28.7 x HbA1c - 46.7
    Inverted: HbA1c = (eAG + 46.7) / 28.7
    Clamped to [5.5, 14.0] %.
    Reference: Nathan et al., Diabetes Care 2008 (formula only; data is synthetic).
    """
    hba1c = (mean_glucose_mgdl + 46.7) / 28.7
    return float(np.clip(hba1c + RNG.normal(0, 0.3), 5.5, 14.0))


def _glucose_to_bmi(mean_glucose_mgdl: float) -> float:
    """
    Higher chronic glucose loosely correlates with higher BMI in T2D populations.
    BMI ~ 27 + 0.03 * (mean_glucose - 120) + noise, clamped [21, 45].
    ASSUMPTION: simplified linear relationship for synthetic consistency only.
    """
    bmi = 27.0 + 0.03 * (mean_glucose_mgdl - 120.0) + RNG.normal(0, 2.0)
    return float(np.clip(bmi, 21.0, 45.0))


def generate_patient(pid: int, mean_glucose: float, archetype: Optional[dict] = None) -> dict:
    """Generate one synthetic patient record (Indian T2D demographics).

    If ``archetype`` is provided, its field values are used as the record
    (curated persona). Otherwise, fields are drawn from Indian clinical
    distributions.
    """
    # ── Curated archetype: use as-is ─────────────────────────────────────────
    if archetype is not None:
        rec = dict(archetype)
        rec["patient_id"] = "P%04d" % pid
        rec.setdefault("_mean_glucose_seed", round(mean_glucose, 1))
        return rec

    # ── Indian demographic draws ─────────────────────────────────────────────
    # Earlier T2D onset in South Asians: age ~ N(52, 10), clipped [30, 75]
    age = int(np.clip(RNG.normal(52, 10), 30, 75))
    sex = RNG.choice(["M", "F"], p=[0.52, 0.48])  # slight male predominance
    # Duration correlates with age; recently-diagnosed younger patients exist
    diabetes_duration_yrs = int(np.clip(RNG.normal((age - 30) * 0.35, 4), 0, 30))

    bmi = _glucose_to_bmi(mean_glucose)
    hba1c = _glucose_to_hba1c(mean_glucose)

    # Blood pressure: loosely correlated with BMI; hypertension prevalent in India
    sbp = int(np.clip(115 + (bmi - 25) * 1.5 + RNG.normal(0, 9), 100, 190))
    dbp = int(np.clip(72 + (bmi - 25) * 0.7 + RNG.normal(0, 5), 60, 115))

    medication = RNG.choice(MEDICATIONS, p=MED_WEIGHTS)

    # Comorbidities: hypertension weighted higher (common in Indian T2D)
    n_comorbid_max = int(np.clip((hba1c - 5.5) / 2.0 * 3 + 1, 0, 4))
    weights = np.array([0.35, 0.25, 0.10, 0.10, 0.10, 0.10])  # hypertension first
    weights = weights / weights.sum()
    n_draw = min(n_comorbid_max, len(COMORBIDITIES))
    comorbid = list(RNG.choice(COMORBIDITIES, size=n_draw, replace=False, p=weights))

    # Genetic risk alleles - South-Asian enriched (higher than generic 25%)
    genetic_risk = {flag: int(RNG.random() < 0.40) for flag in GENETIC_FLAGS}

    # Prior hyperglycaemia events in past 90 days (self-reported, synthetic)
    prior_events = int(np.clip(RNG.poisson((hba1c - 5.5) * 2), 0, 30))

    return {
        "patient_id": "P%04d" % pid,
        "age": age,
        "sex": sex,
        "bmi": round(bmi, 1),
        "diabetes_duration_yrs": diabetes_duration_yrs,
        "hba1c_pct": round(hba1c, 1),
        "sbp_mmhg": sbp,
        "dbp_mmhg": dbp,
        "medication": medication,
        "prior_hyper_events_90d": prior_events,
        "n_comorbidities": len(comorbid),
        **{"comorbid_%s" % c: int(c in comorbid) for c in COMORBIDITIES},
        **{k: v for k, v in genetic_risk.items()},
        # Store mean glucose so build_windows.py can verify consistency
        "_mean_glucose_seed": round(mean_glucose, 1),
    }


def main():
    os.makedirs(os.path.dirname(os.path.abspath(OUT_PATH)), exist_ok=True)

    # Mean glucose for each patient: sample from a distribution typical of T2D
    # Range ~100-200 mg/dL; mix of well-controlled and poorly-controlled patients
    # ~40% well-controlled (mean 100-130), ~40% moderate (130-170), ~20% poorly controlled (170-220)
    mean_glucoses = np.concatenate([
        RNG.uniform(100, 135, size=int(N_PATIENTS * 0.40)),   # well-controlled
        RNG.uniform(135, 175, size=int(N_PATIENTS * 0.40)),   # moderate
        RNG.uniform(175, 225, size=N_PATIENTS - int(N_PATIENTS * 0.80)),  # poor
    ])
    RNG.shuffle(mean_glucoses)
    mean_glucoses = np.clip(mean_glucoses, 95.0, 230.0)

    patients = []
    # ── Emit curated archetypes first (P0001-P0005) ─────────────────────────
    for i, arch in enumerate(ARCHETYPES):
        pid = i + 1
        patients.append(generate_patient(pid, arch["_mean_glucose_seed"], archetype=arch))

    # ── Remaining patients: Indian demographic draws (P0006-P0500) ──────────
    for i in range(len(ARCHETYPES), N_PATIENTS):
        pid = i + 1
        patients.append(generate_patient(pid, mean_glucoses[i]))

    df = pd.DataFrame(patients)
    df.to_csv(OUT_PATH, index=False)

    # Save patient ID list for downstream scripts
    patient_ids = df["patient_id"].tolist()
    with open(PATIENT_IDS_PATH, "w") as f:
        json.dump(patient_ids, f)

    print("[OK] EHR generated: %d patients -> %s" % (len(df), OUT_PATH))
    print("   Archetypes:   %s" % df["_archetype"].dropna().tolist())
    print("   HbA1c range:  %.1f - %.1f %%" % (df["hba1c_pct"].min(), df["hba1c_pct"].max()))
    print("   BMI range:    %.1f - %.1f kg/m2" % (df["bmi"].min(), df["bmi"].max()))
    print("   Age range:    %d - %d years" % (df["age"].min(), df["age"].max()))
    print("   Medications:  %s" % df["medication"].value_counts().to_dict())
    print("   Hypertension: %d patients" % int(df.get("comorbid_hypertension", pd.Series([0])).sum()))


if __name__ == "__main__":
    main()
