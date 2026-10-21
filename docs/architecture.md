# HealthTwin Architecture

HealthTwin is a synthetic-data research prototype. The visual flow below summarizes the demonstrated application; the twin state block means the physiological ODE state, not a learned/EKF parameter estimator.

![HealthTwin architecture](architecture.png)

The diagram is rendered from `scripts/build_submission_docs.py` using Matplotlib. The companion PDF is [`architecture.pdf`](architecture.pdf).

## Components

- **Data sources:** procedurally generated EHR and synthetic CGM/wearable streams.
- **Fusion:** a bidirectional GRU encodes 24 time steps and 7 channels; an MLP encodes 12 EHR features; a fusion head emits a spike probability and four forecast values.
- **Twin state:** the ODE tracks glucose, insulin, remote insulin action, and gut glucose. No EKF or Bayesian parameter estimator is implemented in the current source.
- **Predictor:** the trained fusion model and tabular baselines classify whether glucose exceeds 180 mg/dL in the next two hours.
- **Simulator:** what-if interventions modify an input window and run predictor inference. They are not causal effects.
- **Dashboard:** React pages call the FastAPI service on port 8000; Vite serves the UI on port 5173.

The stored metrics file is not reproducible from current processed arrays. See [`data.md`](data.md) for the discrepancy and constraints.
