"""
main.py  â€”  HealthTwin FastAPI backend  v2
------------------------------------------
All responses come from real trained models. No hardcoded numbers.

Routes:
  GET  /health
  GET  /patients                          list all patients
  GET  /patient/{pid}                     EHR profile + latest window summary
  GET  /predict/{pid}?window_idx=...      probability, interval, risk band, forecast
  GET  /explain/{pid}?window_idx=...      ranked factor contributions (sum to 100%)
  POST /whatif/{pid}                      body: interventions -> new prob, trajectory, delta
  GET  /metrics                           results/metrics.json
  GET  /stream/{pid}                      SSE: replay wearable series as live stream
  GET  /sample/{pid}                      sample a random window (used by old UI)
  POST /predict                           (legacy) raw window input
  POST /forecast                          (legacy) raw window input
  POST /explain                           (legacy) raw window input
  POST /whatif                            (legacy) raw window input

Risk bands (model bands, not medical standards):
  < 30%  Low | 30-60%  Moderate | 60-80%  High | > 80%  Very High

Disclaimer: Simulated data. Model outputs are not clinical advice.
"""

import os
import sys
import json
import pickle
import random
import asyncio
import numpy as np
import torch
from pathlib import Path
from typing import Optional, AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BASE / "src"))

PROC_DIR    = BASE / "data" / "processed"
RAW_DIR     = BASE / "data" / "raw"
RESULTS_DIR = BASE / "results"

from models.fusion_model import FusionModel
from models.baselines import extract_features
from models.forecast import get_forecast, build_display_series
from models.whatif import simulate_whatif, load_scalers, risk_band
from models.explain import grouped_factors, local_attribution, _raw_importances

_registry: dict = {}


# â”€â”€ Startup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _load_all():
    with open(PROC_DIR / "ehr_cols.json") as f:
        ehr_cols = json.load(f)
    with open(PROC_DIR / "ts_channels.json") as f:
        ts_channels = json.load(f)
    with open(RESULTS_DIR / "calibration_temp.json") as f:
        temperature = json.load(f)["temperature"]

    ehr_dim = len(ehr_cols)
    ts_dim  = len(ts_channels)

    fusion = FusionModel(ehr_input_dim=ehr_dim, ts_input_dim=ts_dim, dropout=0.3)
    fusion.load_state_dict(torch.load(
        RESULTS_DIR / "fusion_model.pt", map_location="cpu", weights_only=True))
    fusion.eval()

    with open(RESULTS_DIR / "xgboost.pkl", "rb") as f:
        xgb = pickle.load(f)
    with open(RESULTS_DIR / "logreg.pkl", "rb") as f:
        logreg = pickle.load(f)

    scaler_ts, scaler_ehr = load_scalers()

    import pandas as pd
    ehr_df = pd.read_csv(RAW_DIR / "ehr.csv")

    _registry.update({
        "fusion": fusion, "xgb": xgb, "logreg": logreg,
        "scaler_ts": scaler_ts, "scaler_ehr": scaler_ehr,
        "ehr_cols": ehr_cols, "ts_channels": ts_channels,
        "temperature": temperature, "ehr_df": ehr_df,
    })

    for key, path in [
        ("shap_values",          RESULTS_DIR / "shap_values.json"),
        ("saliency_ts",          RESULTS_DIR / "saliency_ts.json"),
        ("factor_group_weights", RESULTS_DIR / "factor_group_weights.json"),
        ("sanity_tests",         RESULTS_DIR / "sanity_tests.json"),
    ]:
        _registry[key] = json.loads(path.read_text()) if path.exists() else {}

    print(f"[HealthTwin API v2] Models loaded. EHR={ehr_dim}d, TS={ts_dim}ch, T={temperature:.4f}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_all()
    yield


app = FastAPI(
    title="HealthTwin API",
    description="Digital Twin for T2D Glucose-Event Prediction. Simulated data only.",
    version="2.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(RESULTS_DIR / "plots")), name="static")


# â”€â”€ Schemas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class WindowInput(BaseModel):
    x_ts_flat: list[float] = Field(..., min_length=168, max_length=168)
    x_ehr:     list[float] = Field(..., min_length=12,  max_length=12)
    n_mc: int = Field(default=20, ge=5, le=50)


class WhatIfBody(BaseModel):
    interventions: dict = Field(default={}, description=(
        "reduce_carbs_g (float), add_medication (bool), increase_steps (float), "
        "glucose_offset_mgdl (float), change_medication (str), "
        "sleep_quality (int 0-3), stress_level (float 0-1), med_adherence (float 0-1)"
    ))
    n_mc: int = Field(default=20, ge=5, le=50)


class WhatIfInput(BaseModel):
    x_ts_flat:     list[float] = Field(..., min_length=168, max_length=168)
    x_ehr:         list[float] = Field(..., min_length=12,  max_length=12)
    interventions: dict        = Field(default={})
    n_mc: int = Field(default=20, ge=5, le=50)


# â”€â”€ Internal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

EHR_COLS_CONST = [
    "age", "bmi", "diabetes_duration_yrs", "hba1c_pct",
    "sbp_mmhg", "dbp_mmhg", "prior_hyper_events_90d", "n_comorbidities",
    "TCF7L2_risk", "KCNJ11_risk", "PPARG_risk", "medication_encoded",
]
MED_ENCODING = {"Metformin": 0, "Glipizide": 1, "Insulin_basal": 2, "Sitagliptin": 3, "None": 4}


def _get_patient_windows(pid: str):
    """Return (wins_ts, wins_y, cgm_df, ehr_row) for a patient."""
    import pandas as pd
    from src.data.build_windows import build_patient_windows

    cgm_path = RAW_DIR / f"cgm_{pid}.parquet"
    if not cgm_path.exists():
        raise HTTPException(404, f"CGM not found for {pid}")

    cgm_df  = pd.read_parquet(cgm_path)
    ehr_df  = _registry["ehr_df"]
    row     = ehr_df[ehr_df["patient_id"] == pid]
    if row.empty:
        raise HTTPException(404, f"Patient {pid} not found")

    wins_ts, wins_y, wins_yf = build_patient_windows(cgm_df)
    if len(wins_ts) == 0:
        raise HTTPException(500, f"No valid windows for {pid}")

    return wins_ts, wins_y, cgm_df, row.iloc[0]


def _ehr_raw_from_row(row_dict: dict) -> np.ndarray:
    row_dict["medication_encoded"] = float(MED_ENCODING.get(row_dict.get("medication", "None"), 4))
    return np.array([float(row_dict.get(c, 0)) for c in EHR_COLS_CONST], dtype=np.float32)


def _scale_window(x_ts_raw, x_ehr_raw):
    s_ts  = _registry["scaler_ts"]
    s_ehr = _registry["scaler_ehr"]
    x_ts_sc  = s_ts.transform(x_ts_raw).astype(np.float32)
    x_ehr_sc = s_ehr.transform(x_ehr_raw.reshape(1, -1)).astype(np.float32).squeeze()
    return x_ts_sc, x_ehr_sc


def _run_prediction(x_ts_sc, x_ehr_sc, n_mc=20):
    T     = _registry["temperature"]
    model = _registry["fusion"]
    payload = get_forecast(x_ts_sc, x_ehr_sc, model, temperature=T, n_mc=n_mc,
                           scaler_ts=_registry["scaler_ts"])
    prob = payload["prob_mean"]
    Xf   = extract_features(x_ts_sc[np.newaxis], x_ehr_sc[np.newaxis])
    return {
        "prob_mean":       prob,
        "prob_lower":      payload["prob_lower"],
        "prob_upper":      payload["prob_upper"],
        "risk_band":       risk_band(prob),
        "forecast":        payload["forecast"],
        "forecast_lower":  payload["forecast_lower"],
        "forecast_upper":  payload["forecast_upper"],
        "baseline_models": {
            "xgboost_prob": round(float(_registry["xgb"].predict_proba(Xf)[0, 1]), 4),
            "logreg_prob":  round(float(_registry["logreg"].predict_proba(Xf)[0, 1]), 4),
        },
        "threshold_mgdl": 180,
        "horizon_hours":  2,
        "disclaimer": "Simulated data. Model outputs are not clinical advice.",
    }


def _run_explain(x_ts_sc, x_ehr_sc):
    s_ts  = _registry["scaler_ts"]
    x_ts_raw = s_ts.inverse_transform(x_ts_sc).astype(np.float32)
    glucose  = x_ts_raw[:, 0]

    attr = local_attribution(x_ts_sc, x_ehr_sc)

    return {
        "factor_contributions": attr["ranked"],
        "factors":              attr["factors"],
        "sum_check_pct":        attr["sum_check"],
        "global_feature_importance": _registry["shap_values"],
        "channel_saliency":    _registry["saliency_ts"],
        "window_glucose_stats": {
            "glucose_mean":  round(float(glucose.mean()), 1),
            "glucose_std":   round(float(glucose.std()), 1),
            "glucose_min":   round(float(glucose.min()), 1),
            "glucose_max":   round(float(glucose.max()), 1),
            "glucose_last":  round(float(glucose[-1]), 1),
            "glucose_slope_mgdl_per_15min": round(
                float(np.polyfit(np.arange(24), glucose, 1)[0]), 2),
        },
        "disclaimer": "Simulated data. Model outputs are not clinical advice.",
    }


# â”€â”€ Routes: system â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/health")
def health():
    return {"status": "ok", "models_loaded": bool(_registry),
            "disclaimer": "Simulated data. Model outputs are not clinical advice."}


@app.get("/metrics")
def get_metrics():
    path = RESULTS_DIR / "metrics.json"
    if not path.exists():
        raise HTTPException(503, "metrics.json not found. Run evaluate.py first.")
    data = json.loads(path.read_text())
    # Attach sanity test results if available
    if _registry.get("sanity_tests"):
        data["sanity_tests"] = _registry["sanity_tests"]
    return data


# â”€â”€ Routes: patients â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/patients")
def list_patients():
    ehr_df = _registry["ehr_df"]
    return {"patient_ids": ehr_df["patient_id"].tolist(), "count": len(ehr_df)}


@app.get("/patient/{pid}")
def get_patient(pid: str):
    """EHR profile + latest-window summary."""
    ehr_df = _registry["ehr_df"]
    row    = ehr_df[ehr_df["patient_id"] == pid]
    if row.empty:
        raise HTTPException(404, f"Patient {pid} not found")
    record = row.iloc[0].to_dict()
    record.pop("_mean_glucose_seed", None)

    # Try to add a quick window summary (last window)
    try:
        wins_ts, wins_y, _, _ = _get_patient_windows(pid)
        idx = len(wins_ts) - 1
        x_ts_raw = wins_ts[idx]
        x_ehr_raw = _ehr_raw_from_row(record.copy())
        x_ts_sc, x_ehr_sc = _scale_window(x_ts_raw, x_ehr_raw)
        pred = _run_prediction(x_ts_sc, x_ehr_sc, n_mc=10)
        window_summary = {
            "window_index": idx,
            "label": int(wins_y[idx]),
            "prob_mean": pred["prob_mean"],
            "risk_band": pred["risk_band"],
            "last_glucose_mgdl": round(float(x_ts_raw[-1, 0]), 1),
        }
    except Exception as e:
        window_summary = {"error": str(e)}

    return {
        "patient": record,
        "latest_window": window_summary,
        "disclaimer": "Simulated data. Not clinical advice.",
    }


@app.get("/sample/{pid}")
def sample_patient_window(pid: str):
    """Sample a random window (for legacy UI compatibility)."""
    import pandas as pd
    from src.data.build_windows import build_patient_windows

    cgm_path = RAW_DIR / f"cgm_{pid}.parquet"
    if not cgm_path.exists():
        raise HTTPException(404, f"CGM not found for {pid}")

    cgm_df  = pd.read_parquet(cgm_path)
    ehr_df  = _registry["ehr_df"]
    row     = ehr_df[ehr_df["patient_id"] == pid]
    if row.empty:
        raise HTTPException(404, f"EHR not found for {pid}")

    wins_ts, wins_y, wins_yf = build_patient_windows(cgm_df)
    if len(wins_ts) == 0:
        raise HTTPException(500, f"No valid windows for {pid}")

    idx       = random.randint(0, len(wins_ts) - 1)
    x_ts_raw  = wins_ts[idx]
    row_dict  = row.iloc[0].to_dict()
    x_ehr_raw = _ehr_raw_from_row(row_dict)
    x_ts_sc, x_ehr_sc = _scale_window(x_ts_raw, x_ehr_raw)

    return {
        "patient_id":        pid,
        "window_index":      idx,
        "label":             int(wins_y[idx]),
        "x_ts_flat":         x_ts_sc.flatten().tolist(),
        "x_ehr":             x_ehr_sc.tolist(),
        "x_ts_raw_glucose":  [round(float(x_ts_raw[i, 0]), 1) for i in range(24)],
        "x_ts_raw_full":     x_ts_raw.tolist(),
    }


# â”€â”€ Routes: inference (GET by patient ID) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/predict/{pid}")
def predict_by_id(pid: str, window_idx: Optional[int] = Query(None)):
    """GET /predict/{pid}?window_idx=N  (omit window_idx for random)"""
    wins_ts, wins_y, _, row = _get_patient_windows(pid)
    idx       = window_idx if window_idx is not None else random.randint(0, len(wins_ts)-1)
    idx       = max(0, min(idx, len(wins_ts)-1))
    x_ts_raw  = wins_ts[idx]
    x_ehr_raw = _ehr_raw_from_row(row.to_dict())
    x_ts_sc, x_ehr_sc = _scale_window(x_ts_raw, x_ehr_raw)
    result = _run_prediction(x_ts_sc, x_ehr_sc)
    result["window_index"] = idx
    result["true_label"]   = int(wins_y[idx])
    return result


@app.get("/explain/{pid}")
def explain_by_id(pid: str, window_idx: Optional[int] = Query(None)):
    """GET /explain/{pid}?window_idx=N â€” ranked factor contributions summing to 100%"""
    wins_ts, wins_y, _, row = _get_patient_windows(pid)
    idx       = window_idx if window_idx is not None else random.randint(0, len(wins_ts)-1)
    idx       = max(0, min(idx, len(wins_ts)-1))
    x_ts_raw  = wins_ts[idx]
    x_ehr_raw = _ehr_raw_from_row(row.to_dict())
    x_ts_sc, x_ehr_sc = _scale_window(x_ts_raw, x_ehr_raw)
    result = _run_explain(x_ts_sc, x_ehr_sc)
    result["window_index"] = idx
    result["true_label"]   = int(wins_y[idx])
    return result


@app.post("/whatif/{pid}")
def whatif_by_id(pid: str, body: WhatIfBody):
    """POST /whatif/{pid}  body: {interventions, n_mc}"""
    wins_ts, wins_y, _, row = _get_patient_windows(pid)
    idx       = random.randint(0, len(wins_ts) - 1)
    x_ts_raw  = wins_ts[idx]
    x_ehr_raw = _ehr_raw_from_row(row.to_dict())
    T = _registry["temperature"]
    result = simulate_whatif(
        x_ts_raw, x_ehr_raw, body.interventions,
        _registry["fusion"], _registry["scaler_ts"], _registry["scaler_ehr"],
        temperature=T, n_mc=body.n_mc,
    )
    result["window_index"] = idx
    return result


# â”€â”€ Routes: SSE stream â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.get("/stream/{pid}")
async def stream_wearables(pid: str, speed_ms: int = Query(default=500, ge=100, le=5000)):
    """
    GET /stream/{pid}?speed_ms=500
    Server-Sent Events: replays the patient's last 6-hour wearable window
    at `speed_ms` intervals, emitting one 15-min step per tick.
    Labelled "Simulated stream" â€” not a real device feed.
    """
    import pandas as pd
    from src.data.build_windows import build_patient_windows

    cgm_path = RAW_DIR / f"cgm_{pid}.parquet"
    if not cgm_path.exists():
        raise HTTPException(404, f"CGM not found for {pid}")

    cgm_df    = pd.read_parquet(cgm_path)
    wins_ts, wins_y, _ = build_patient_windows(cgm_df)
    if len(wins_ts) == 0:
        raise HTTPException(500, f"No windows for {pid}")

    # Use a mid-day window (not always the same one)
    idx   = min(len(wins_ts) // 2, len(wins_ts) - 1)
    window = wins_ts[idx]   # (24, 7) unscaled
    CHANNELS = ["glucose_mgdl", "heart_rate_bpm", "hrv_ms",
                 "steps_5min", "sleep_state", "carbs_15min", "med_taken"]

    async def event_generator() -> AsyncGenerator[str, None]:
        for step in range(24):
            row_data = {
                "step":      step,
                "t_min":     (step - 23) * 15,
                "source":    "Simulated stream",
                **{CHANNELS[c]: round(float(window[step, c]), 2)
                   for c in range(len(CHANNELS))},
            }
            yield f"data: {json.dumps(row_data)}\n\n"
            await asyncio.sleep(speed_ms / 1000.0)
        yield "data: {\"event\": \"stream_end\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# â”€â”€ Routes: legacy POST endpoints (keep for old UI) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.post("/predict")
def predict_legacy(inp: WindowInput):
    x_ts  = np.array(inp.x_ts_flat, dtype=np.float32).reshape(24, 7)
    x_ehr = np.array(inp.x_ehr,     dtype=np.float32)
    return _run_prediction(x_ts, x_ehr, inp.n_mc)


@app.post("/forecast")
def forecast_legacy(inp: WindowInput):
    x_ts_sc  = np.array(inp.x_ts_flat, dtype=np.float32).reshape(24, 7)
    x_ehr_sc = np.array(inp.x_ehr,     dtype=np.float32)
    x_ts_raw = _registry["scaler_ts"].inverse_transform(x_ts_sc).astype(np.float32)
    x_ehr_raw= _registry["scaler_ehr"].inverse_transform(x_ehr_sc.reshape(1,-1)).astype(np.float32).squeeze()
    T        = _registry["temperature"]
    payload  = get_forecast(x_ts_sc, x_ehr_sc, _registry["fusion"], temperature=T,
                            n_mc=inp.n_mc, scaler_ts=_registry["scaler_ts"])
    display  = build_display_series(x_ts_raw, payload)
    return {**payload, "display_series": display,
            "disclaimer": "Simulated data. Model outputs are not clinical advice."}


@app.post("/explain")
def explain_legacy(inp: WindowInput):
    x_ts_sc  = np.array(inp.x_ts_flat, dtype=np.float32).reshape(24, 7)
    x_ehr_sc = np.array(inp.x_ehr,     dtype=np.float32)
    return _run_explain(x_ts_sc, x_ehr_sc)


@app.post("/whatif")
def whatif_legacy(inp: WhatIfInput):
    x_ts_sc  = np.array(inp.x_ts_flat, dtype=np.float32).reshape(24, 7)
    x_ehr_sc = np.array(inp.x_ehr,     dtype=np.float32)
    x_ts_raw = _registry["scaler_ts"].inverse_transform(x_ts_sc).astype(np.float32)
    x_ehr_raw= _registry["scaler_ehr"].inverse_transform(x_ehr_sc.reshape(1,-1)).astype(np.float32).squeeze()
    T = _registry["temperature"]
    return simulate_whatif(
        x_ts_raw, x_ehr_raw, inp.interventions,
        _registry["fusion"], _registry["scaler_ts"], _registry["scaler_ehr"],
        temperature=T, n_mc=inp.n_mc,
    )




@app.get("/windows/{pid}")
def get_windows(
    pid: str,
    risk: str = Query(default="any", description="high | low | any"),
    limit: int = Query(default=5, ge=1, le=20),
):
    """
    GET /windows/{pid}?risk=high&limit=5
    Returns candidate windows with probability and true label.
    risk=high -> prob_mean > 0.5 AND true_label == 1
    risk=low  -> prob_mean <= 0.5 AND true_label == 0
    risk=any  -> random sample
    """
    wins_ts, wins_y, _, row = _get_patient_windows(pid)
    x_ehr_raw = _ehr_raw_from_row(row.to_dict())

    rng = np.random.default_rng(42)
    candidate_idx = rng.choice(len(wins_ts), min(80, len(wins_ts)), replace=False).tolist()

    results = []
    for idx in candidate_idx:
        x_ts_raw = wins_ts[int(idx)]
        x_ts_sc, x_ehr_sc = _scale_window(x_ts_raw, x_ehr_raw)
        pred = _run_prediction(x_ts_sc, x_ehr_sc, n_mc=5)
        prob  = pred["prob_mean"]
        label = int(wins_y[int(idx)])
        last_g = round(float(x_ts_raw[-1, 0]), 1)

        if risk == "high" and not (prob > 0.5 and label == 1):
            continue
        if risk == "low" and not (prob <= 0.5 and label == 0):
            continue

        results.append({
            "window_index":    int(idx),
            "prob_mean":       round(prob, 4),
            "risk_band":       pred["risk_band"],
            "true_label":      label,
            "last_glucose":    last_g,
            "above_threshold": last_g > 180,
        })
        if len(results) >= limit:
            break

    if not results:
        for idx in candidate_idx[:limit]:
            x_ts_raw = wins_ts[int(idx)]
            x_ts_sc, x_ehr_sc = _scale_window(x_ts_raw, x_ehr_raw)
            pred = _run_prediction(x_ts_sc, x_ehr_sc, n_mc=5)
            results.append({
                "window_index": int(idx),
                "prob_mean":    round(pred["prob_mean"], 4),
                "risk_band":    pred["risk_band"],
                "true_label":   int(wins_y[int(idx)]),
                "last_glucose": round(float(wins_ts[int(idx)][-1, 0]), 1),
                "above_threshold": float(wins_ts[int(idx)][-1, 0]) > 180,
            })

    return {"windows": results, "patient_id": pid, "risk_filter": risk}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.api.main:app", host="0.0.0.0", port=8000, reload=True)

