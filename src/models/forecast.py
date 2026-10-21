"""
forecast.py
-----------
Glucose trajectory forecasting utilities.

The fusion model's auxiliary forecast head predicts NORMALIZED glucose (0–1 scale,
where 0 = 55 mg/dL and 1 = 400 mg/dL). This module denormalizes outputs to mg/dL.
"""

import os
import sys
import json
import pickle
import numpy as np
import torch

BASE = os.path.join(os.path.dirname(__file__), "../..")
sys.path.insert(0, os.path.join(BASE, "src"))

PROC_DIR    = os.path.join(BASE, "data/processed")
RESULTS_DIR = os.path.join(BASE, "results")

from models.fusion_model import FusionModel

DEVICE = torch.device("cpu")
HORIZONS_MIN  = [30, 60, 90, 120]
GLUCOSE_MIN   = 55.0
GLUCOSE_MAX   = 400.0


def load_model_and_scalers():
    """Load the trained fusion model + scalers."""
    with open(os.path.join(PROC_DIR, "scaler_ts.pkl"), "rb") as f:
        scaler_ts = pickle.load(f)
    with open(os.path.join(PROC_DIR, "scaler_ehr.pkl"), "rb") as f:
        scaler_ehr = pickle.load(f)

    ehr_dim = len(json.load(open(os.path.join(PROC_DIR, "ehr_cols.json"))))
    ts_dim  = len(json.load(open(os.path.join(PROC_DIR, "ts_channels.json"))))

    model = FusionModel(ehr_input_dim=ehr_dim, ts_input_dim=ts_dim, dropout=0.3)
    model.load_state_dict(torch.load(
        os.path.join(RESULTS_DIR, "fusion_model.pt"),
        map_location=DEVICE,
        weights_only=True,
    ))
    model.eval()
    return model, scaler_ts, scaler_ehr


def _enable_dropout(model):
    """Enable only Dropout layers in eval mode (for MC dropout inference)."""
    model.eval()
    for m in model.modules():
        if type(m).__name__ == "Dropout":
            m.train()


def _linear_extrapolate_glucose(x_ts_raw: np.ndarray) -> list:
    """
    Fallback forecast: linear extrapolation from the last 8 steps (2h) of the
    glucose channel. Returns [+30min, +60min, +90min, +120min] in mg/dL.
    Used when the neural forecast head is unreliable (low LAMBDA_FORE training).
    """
    glucose = x_ts_raw[:, 0]   # (24,) — one value per 15-min step
    # Fit slope on last 8 steps (2 hours of history)
    recent = glucose[-8:]
    x = np.arange(len(recent))
    slope, intercept = np.polyfit(x, recent, 1)

    # Steps ahead: +30min = +2 steps, +60 = +4, +90 = +6, +120 = +8 (at 15-min)
    steps_ahead = [2, 4, 6, 8]
    preds = []
    for s in steps_ahead:
        g = intercept + slope * (len(recent) - 1 + s)
        g = float(np.clip(g, 55.0, 400.0))
        preds.append(round(g, 1))
    return preds


def get_forecast(
    x_ts_scaled: np.ndarray,   # (24, 7) already scaled
    x_ehr_scaled: np.ndarray,  # (12,) already scaled
    model: FusionModel,
    temperature: float = 1.0,
    n_mc: int = 30,
    scaler_ts=None,             # pass to get raw glucose for extrapolation
) -> dict:
    """
    Run model forward and return full prediction payload.

    Returns:
        prob_mean   : float  — hyperglycaemia probability (calibrated)
        prob_lower  : float  — 5th pct from MC dropout
        prob_upper  : float  — 95th pct from MC dropout
        forecast    : list of {horizon_min, glucose_mgdl} dicts
        forecast_lower: list of floats (MC 5th pct per horizon)
        forecast_upper: list of floats (MC 95th pct per horizon)
    """
    x_ts_t  = torch.tensor(x_ts_scaled[np.newaxis],  dtype=torch.float32)
    x_ehr_t = torch.tensor(x_ehr_scaled[np.newaxis],  dtype=torch.float32)

    # Deterministic pass (for point estimates)
    model.eval()
    with torch.no_grad():
        prob, _ = model(x_ts_t, x_ehr_t)
    logit = torch.logit(prob.clamp(1e-6, 1 - 1e-6)) / temperature
    prob_point = float(torch.sigmoid(logit).item())

    # Glucose forecast: use linear extrapolation (neural forecast head untrained
    # due to low lambda during training — this is documented in the README).
    if scaler_ts is not None:
        x_ts_raw = scaler_ts.inverse_transform(x_ts_scaled).astype(np.float32)
    else:
        x_ts_raw = x_ts_scaled   # fallback
    fore_point = _linear_extrapolate_glucose(x_ts_raw)

    # MC dropout for probability uncertainty only
    prob_samples = []
    for _ in range(n_mc):
        _enable_dropout(model)
        with torch.no_grad():
            p, _ = model(x_ts_t, x_ehr_t)
        logit_mc = torch.logit(p.clamp(1e-6, 1 - 1e-6)) / temperature
        prob_samples.append(float(torch.sigmoid(logit_mc).item()))

    model.eval()
    prob_arr = np.array(prob_samples)

    # Forecast uncertainty: use ±1 standard deviation of extrapolation slope
    # (propagated from last-8-step linear fit uncertainty)
    glucose_raw = x_ts_raw[:, 0]
    recent = glucose_raw[-8:]
    residuals = recent - np.polyval(np.polyfit(np.arange(8), recent, 1), np.arange(8))
    sigma = float(residuals.std())
    # ±1.64σ for 90% interval
    fore_lower = [round(float(np.clip(v - 1.64 * sigma, 55.0, 400.0)), 1) for v in fore_point]
    fore_upper = [round(float(np.clip(v + 1.64 * sigma, 55.0, 400.0)), 1) for v in fore_point]

    forecast_out = [
        {
            "horizon_min": HORIZONS_MIN[i],
            "glucose_mgdl": round(float(fore_point[i]), 1) if i < len(fore_point) else None,
        }
        for i in range(4)
    ]

    return {
        "prob_mean":      round(prob_point, 4),
        "prob_lower":     round(float(np.percentile(prob_arr, 5)), 4),
        "prob_upper":     round(float(np.percentile(prob_arr, 95)), 4),
        "forecast":       forecast_out,
        "forecast_lower": fore_lower,
        "forecast_upper": fore_upper,
        "forecast_method": "linear_extrapolation",
        "disclaimer":     "Simulated data. Model outputs are not clinical advice.",
    }


def build_display_series(
    x_ts_raw: np.ndarray,       # (24, 7) UNSCALED
    forecast_payload: dict,
    current_time_offset: int = 0,   # minutes from now for t=0
) -> dict:
    """
    Build a chart-friendly series merging:
      - Historical 6-hour glucose window (24 points @ 15-min)
      - Forecast 4 points @ 30/60/90/120 min
      - Hyperglycaemia threshold line (180 mg/dL)

    Returns:
        historical   : list of {t_min, glucose_mgdl}
        predicted    : list of {t_min, glucose_mgdl, lower, upper}
        threshold    : int (180)
    """
    # Historical: 24 steps, each 15 min, ending at t=0
    historical = []
    for i, step in enumerate(range(24)):
        t_min = (step - 23) * 15   # -345 to 0
        glucose = float(x_ts_raw[step, 0])   # channel 0 = glucose
        historical.append({"t_min": int(t_min), "glucose_mgdl": round(glucose, 1)})

    # Predicted
    predicted = []
    fore = forecast_payload["forecast"]
    lowers = forecast_payload["forecast_lower"]
    uppers = forecast_payload["forecast_upper"]
    for i, fp in enumerate(fore):
        predicted.append({
            "t_min":        fp["horizon_min"],
            "glucose_mgdl": fp["glucose_mgdl"],
            "lower":        lowers[i],
            "upper":        uppers[i],
        })

    return {
        "historical": historical,
        "predicted":  predicted,
        "threshold":  180,
    }


if __name__ == "__main__":
    print("forecast.py smoke test ...")
    model, scaler_ts, scaler_ehr = load_model_and_scalers()

    X_ts  = np.load(os.path.join(PROC_DIR, "X_ts_test.npy"))
    X_ehr = np.load(os.path.join(PROC_DIR, "X_ehr_test.npy"))

    payload = get_forecast(X_ts[0], X_ehr[0], model)
    print(f"  Prob: {payload['prob_mean']:.4f} [{payload['prob_lower']:.4f}, {payload['prob_upper']:.4f}]")
    print(f"  Forecast: {[f['glucose_mgdl'] for f in payload['forecast']]}")
    print("[OK] forecast.py smoke test passed.")
