# Data Notes

## Provenance

The project generators create synthetic EHR and five-minute CGM/wearable time series. The included demo bundle is one generated patient (P0001) and its synthetic EHR row; it is not sourced from Synthea, PMData, LifeSnaps, OhioT1DM, or another third-party cohort. Patient-like identifiers are synthetic labels and must not be treated as real identities.

The generated signals include glucose in mg/dL, heart rate in bpm, heart-rate variability in ms, steps per five-minute interval, categorical sleep stage, carbohydrate grams, and medication-adherence flags. Generator assumptions are simplified and are not clinically validated.

## Demo Data

`data/demo/` contains the single-patient files required to start the API. `make demo-data` derives them from the larger locally generated `data/raw/` cohort. The complete raw cohort and processed training arrays are excluded from public version control. Regenerate the full cohort only in a separate working copy because data and training commands overwrite generated outputs.

## Metrics Provenance Warning

`results/metrics.json` records 239,316 training windows with a 58.31% positive rate. The current `data/processed/y_train.npy`, `y_val.npy`, and `y_test.npy` instead contain 997,150, 213,675, and 213,675 labels, respectively, and every value is zero. The accompanying `class_balance.json` agrees with the all-zero arrays and contradicts `metrics.json`. Therefore the stored metrics cannot be reproduced from the current processed data/model set and must not be represented as verified evaluation results. No confidence intervals are stored.

## Reproduction

The generation and training pipeline is described by `make data`, `make train`, and `make evaluate`. It was not run as part of preparing this submission because those commands overwrite generated data and trained artifacts. Regenerate all artifacts together in a clean workspace before making performance claims.