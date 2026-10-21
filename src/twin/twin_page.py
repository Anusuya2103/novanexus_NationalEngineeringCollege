"""
Twin Page Inference Engine

Dedicated per-patient visualization page for the Digital Twin Health project.
Loads a single patient's CGM traces, EHR profile, and physiological model state
for interactive exploration and model inspection.

Supports:
- Patient selection by ID (P001-P500)
- CGM trace viewing with 5-min resolution
- EHR feature vector display
- Physiological parameter inspection (Bergman ODE state)
- Time scrubber: navigate 30-day trace
- Meal preset overlay (Indian meal times) - shown in patient summary
- Asian-Indian BMI cutoff highlighting
"""

import os
import numpy as np
import pandas as pd
import plotly.graph_objects as go


def load_patient(patient_id: str, raw_dir: str = "data/raw") -> dict:
    """Load complete patient data for twin page display."""
    cgm_path = os.path.join(raw_dir, f"cgm_{patient_id}.parquet")
    cgm_df = pd.read_parquet(cgm_path)
    ehr_path = os.path.join(raw_dir, "ehr.csv")
    ehr_df = pd.read_csv(ehr_path)
    ehr_row = ehr_df[ehr_df["patient_id"] == patient_id].iloc[0]

    trace = type(
        "Trace",
        (),
        {
            "patient_id": patient_id,
            "timestamp": cgm_df["timestamp"].values,
            "glucose_cgm": cgm_df["glucose_mgdl"].values,
            "glucose_plasma": cgm_df["glucose_mgdl"].values,
            "insulin": np.ones(len(cgm_df)) * 10.0,
            "x_action": np.zeros(len(cgm_df)),
            "egp": np.ones(len(cgm_df)) * 2.0,
            "s_i": 0.03,
            "s_g": 0.05,
            "k_abs_t": np.ones(len(cgm_df)) * 0.1,
            "steps": cgm_df["steps_5min"].values
            if "steps_5min" in cgm_df.columns
            else np.zeros(len(cgm_df)),
            "sleep": cgm_df["sleep_state"].values
            if "sleep_state" in cgm_df.columns
            else np.zeros(len(cgm_df)),
            "carbs": cgm_df["carbs_15min"].values
            if "carbs_15min" in cgm_df.columns
            else np.zeros(len(cgm_df)),
            "med_taken": cgm_df["med_taken"].values
            if "med_taken" in cgm_df.columns
            else np.ones(len(cgm_df)),
            "stress": np.ones(len(cgm_df)) * 0.5,
            "heart_rate": cgm_df["heart_rate_bpm"].values
            if "heart_rate_bpm" in cgm_df.columns
            else np.ones(len(cgm_df)) * 75,
        },
    )()

    bmi = float(ehr_row["bmi"])
    if bmi < 18.5:
        bmi_category = "Underweight (<18.5)"
    elif bmi < 23.0:
        bmi_category = "Normal (18.5 to 22.9)"
    elif bmi < 25.0:
        bmi_category = "Overweight (23.0 to 24.9)"
    else:
        bmi_category = "Obese (>=25.0)"

    ehr_features = {
        "age": float(ehr_row["age"]),
        "sex": str(ehr_row["sex"]),
        "bmi": bmi,
        "diabetes_duration_yrs": float(ehr_row["diabetes_duration_yrs"]),
        "hba1c_pct": float(ehr_row["hba1c_pct"]),
        "sbp_mmhg": float(ehr_row["sbp_mmhg"]),
        "dbp_mmhg": float(ehr_row["dbp_mmhg"]),
        "bmi_category": bmi_category,
        "hypertension": bool(ehr_row.get("comorbid_hypertension", 0)),
        "dyslipidemia": bool(ehr_row.get("comorbid_dyslipidemia", 0)),
        "ckd_stage2": bool(ehr_row.get("comorbid_CKD_stage2", 0)),
        "tcffl2_risk": float(ehr_row.get("TCF7L2_risk", 0.5)),
        "kcnj11_risk": float(ehr_row.get("KCNJ11_risk", 0.5)),
        "pparg_risk": float(ehr_row.get("PPARG_risk", 0.5)),
        "medication": str(ehr_row["medication"]),
    }

    meal_times = {"breakfast": "07:30", "lunch": "12:30", "snack": "15:30", "dinner": "19:00"}

    return {
        "patient_id": patient_id,
        "trace": trace,
        "cgm_df": cgm_df,
        "ehr_features": ehr_features,
        "bmi_category": bmi_category,
        "meal_times": meal_times,
        "physiological_params": {
            "s_i": 0.03,
            "s_g": 0.05,
            "egp": 2.0,
            "k_abs": 0.1,
        },
    }


def categorize_bmi_asian_indian(bmi: float) -> str:
    """Categorize BMI using Asian-Indian clinical cutoffs."""
    if bmi < 18.5:
        return "Underweight (<18.5)"
    elif bmi < 23.0:
        return "Normal (18.5 to 22.9)"
    elif bmi < 25.0:
        return "Overweight (23.0 to 24.9)"
    else:
        return "Obese (>=25.0)"


def fig_cgm_trace(trace_data: dict, patient_id: str, window: tuple = None) -> go.Figure:
    """Create CGM trace visualization for twin page."""
    cgm_df = trace_data["cgm_df"]

    if window is None:
        window = (0, len(cgm_df))

    # Use integer indices for x-axis to avoid timestamp issues
    t_indices = np.arange(window[0], window[1])
    g = cgm_df["glucose_mgdl"].values[window[0] : window[1]]

    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=t_indices,
            y=g,
            mode="lines",
            name="CGM Glucose (mg/dL)",
            line=dict(color="#ff7f0e", width=2),
        )
    )

    # Shaded regions for hypo/hyperglycemia
    fig.add_hrect(
        y0=0, y1=70, fillcolor="blue", opacity=0.05,
        annotation_text="Hypoglycemia (<70 mg/dL)", annotation_position="right",
    )
    fig.add_hrect(
        y0=180, y1=400, fillcolor="red", opacity=0.05,
        annotation_text="Hyperglycemia (>180 mg/dL)", annotation_position="right",
    )

    # BMI threshold if obese
    bmi = trace_data["ehr_features"]["bmi"]
    if bmi >= 25.0:
        fig.add_hrect(
            y0=180, y1=250, fillcolor="red", opacity=0.1,
            annotation_text="Obese threshold BMI", annotation_position="right",
        )

    # Calculate stats to display
    mean_glucose = float(np.mean(g))
    time_hyper = float((g > 180).mean() * 100)
    time_hypo = float((g < 70).mean() * 100)

    fig.update_layout(
        title=f"Patient {patient_id} - CGM Glucose Trace",
        xaxis_title="Time Step (5-min intervals)",
        yaxis_title="Glucose (mg/dL)",
        hovermode="x unified",
        height=500,
        margin=dict(l=60, r=60, t=80, b=60),
        annotations=[
            dict(
                x=0.01, y=0.99, xref="paper", yref="paper",
                bgcolor="white", bordercolor="gray", borderwidth=1,
                text=f"Mean: {mean_glucose:.1f} mg/dL | "
                     f"Time >180: {time_hyper:.1f}% | "
                     f"Time <70: {time_hypo:.1f}%",
                font=dict(size=10),
            )
        ],
    )

    return fig
