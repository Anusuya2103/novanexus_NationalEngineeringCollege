"""Create the minimal one-patient synthetic bundle required by the demo API."""

from __future__ import annotations

import shutil
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
DEMO = ROOT / "data" / "demo"
PATIENT_ID = "P0001"


def main() -> None:
    source_cgm = RAW / f"cgm_{PATIENT_ID}.parquet"
    source_ehr = RAW / "ehr.csv"
    if not source_cgm.is_file() or not source_ehr.is_file():
        required_demo_files = [
            DEMO / f"cgm_{PATIENT_ID}.parquet",
            DEMO / "ehr.csv",
            DEMO / "patient_ids.json",
        ]
        if all(path.is_file() for path in required_demo_files):
            print("Using the included synthetic P0001 demo bundle.")
            return
        raise SystemExit("Synthetic source data is missing. Run make data first, then retry make demo-data.")

    DEMO.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_cgm, DEMO / source_cgm.name)
    ehr = pd.read_csv(source_ehr)
    patient = ehr.loc[ehr["patient_id"] == PATIENT_ID]
    if patient.empty:
        raise SystemExit(f"No EHR row found for {PATIENT_ID}")
    patient = patient.drop(columns=["_mean_glucose_seed", "_archetype"], errors="ignore")
    patient.to_csv(DEMO / "ehr.csv", index=False)
    (DEMO / "patient_ids.json").write_text(' ["P0001"]\n', encoding="utf-8")
    size = sum(path.stat().st_size for path in DEMO.iterdir() if path.is_file())
    if size >= 10 * 1024 * 1024:
        raise SystemExit(f"Demo data exceeds 10 MB: {size / 1024 / 1024:.2f} MB")
    print(f"Prepared synthetic {PATIENT_ID} demo data ({size / 1024:.1f} KB).")


if __name__ == "__main__":
    main()