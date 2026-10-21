"""
glucose_model.py
----------------
Physiological glucose-insulin digital-twin core (Bergman / UVA-Padova-lite).

Compartments & state variables
    G   : plasma glucose  (mg/dL)
    X   : remote insulin action (min^-1)   -- insulin's effect on glucose disposal
    I   : plasma insulin  (muU/mL)
    Gut : glucose in the gut from a meal   (mg/dL)

Dynamics (per 5-min step, integrated with explicit Euler)
    dGut/dt   = -k_abs * Gut                       (meal absorption)
    dG/dt     = EGP(I, stress) + k_abs*Gut/VG
              - (S_G + S_I * X) * G - U_id
    dX/dt     = -p2 * X + p3 * (I - I_b)
    dI/dt     = -n * (I - I_b) + Secr(G) / Vi

Wearable / lifestyle modulation (the "digital twin" coupling)
    steps   --> raises S_G (glucose effectiveness) and S_I (insulin sensitivity)
    sleep   --> poor sleep lowers S_I; good sleep restores it
    stress  --> raises hepatic EGP, lowers S_I
    carbs   --> enters Gut compartment (absorbed over ~60-90 min)
    metformin --> suppresses hepatic EGP

Outputs
    G_plasma -> interpolated to interstitial CGM with a fixed lag (~10 min).

All values are synthetic / physiologically inspired. Not for clinical use.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

# ── Reproducibility ────────────────────────────────────────────────────────────
SEED = 42
RNG = np.random.default_rng(SEED)

# ── Physiological constants (Bergman minimal model, adult T2D) ─────────────────
VG: float = 3.0          # dL  (glucose distribution volume)
VI: float = 0.15         # L   (effective insulin space)

P2: float = 0.025        # min^-1  -- decay of remote insulin action X
P3: float = 0.00045      # min^-2 per muU/mL  -- X response to insulin
N_I: float = 0.2         # min^-1  -- insulin clearance rate

S_G_BASE: float = 0.02   # min^-1  -- glucose effectiveness (insulin-independent)
S_I_BASE: float = 1.2e-4 # min^-2 per muU/mL -- insulin sensitivity

G_B: float = 100.0       # mg/dL  basal plasma glucose
I_B: float = 12.0        # muU/mL basal insulin
X_B: float = 0.0         # basal remote action

EGP_BASE: float = 3.0     # mg/dL/min basal hepatic output (rebalanced so basal EGP ≈ disposal)
EGP_MAX_SUPPRESSION: float = 0.85  # max fractional suppression by insulin

K_ABS_BASE: float = 0.012   # min^-1  gut absorption rate

CGM_LAG_STEPS: int = 2      # ~10 min physiological lag
CGM_NOISE_SIGMA: float = 4.0  # mg/dL sensor noise

# ── Wearable-modulation gains ──────────────────────────────────────────────────
STEPS_SG_GAIN: float = 2.5e-6     # per step per 5-min
STEPS_SI_GAIN: float = 1.0e-6     # per step per 5-min
SLEEP_SI_GAIN: float = 0.15       # per sleep-quality point (0-3)
STRESS_EGP_GAIN: float = 0.30     # fractional EGP increase per stress unit (0-1)
STRESS_SI_GAIN: float = 0.25      # fractional SI decrease per stress unit
METFORMIN_EGP_SUPP: float = 0.25  # fractional EGP suppression when adherent

G_MIN: float = 55.0
G_MAX: float = 400.0


@dataclass
class TwinParams:
    """Latent physiological parameters for one patient (tracked over time)."""
    S_I: float = S_I_BASE
    S_G: float = S_G_BASE
    k_abs: float = K_ABS_BASE
    insulin_sensitivity_factor: float = 1.0
    glucose_effectiveness_factor: float = 1.0


@dataclass
class WearableInputs:
    """Per-step wearable / lifestyle inputs (5-min resolution)."""
    steps_5min: np.ndarray
    sleep_state: np.ndarray         # 0=awake,1=light,2=deep,3=REM
    carbs_g: np.ndarray             # grams of carbs logged at this step
    med_taken: np.ndarray           # 1 if metformin dose taken this step
    stress: np.ndarray              # 0-1 stress level (derived from HRV/HR)
    heart_rate: np.ndarray          # bpm


@dataclass
class Trace:
    """Simulation output for one patient."""
    timestamp: np.ndarray
    patient_id: str
    glucose_plasma: np.ndarray      # mg/dL  (plasma)
    glucose_cgm: np.ndarray         # mg/dL  (interstitial, lagged + noisy)
    glucose_gut: np.ndarray         # mg/dL  (in gut, unabsorbed)
    insulin: np.ndarray             # muU/mL
    x_action: np.ndarray            # remote insulin action
    egp: np.ndarray                 # mg/dL/min hepatic production
    s_i: np.ndarray                 # effective insulin sensitivity (time-varying)
    s_g: np.ndarray                 # effective glucose effectiveness
    k_abs_t: np.ndarray             # effective absorption rate
    steps: np.ndarray
    sleep: np.ndarray
    carbs: np.ndarray
    med_taken: np.ndarray
    stress: np.ndarray
    heart_rate: np.ndarray

# ── Physiological building blocks ──────────────────────────────────────────────

def _insulin_secretion(glucose: np.ndarray, basal: float = I_B) -> np.ndarray:
    """
    Beta-cell glucose-stimulated insulin secretion (GSIS).
    Sigmoidal above threshold; mimics first- + second-phase secretion.
    Returns secretion rate (muU/mL/min).
    """
    g = np.clip(glucose, 70.0, 300.0)
    # Hill-type secretion: negligible below ~90, rises steeply after
    secr = 0.0 + 0.6 * ((g - 90.0) ** 3) / ((g - 90.0) ** 3 + 60.0 ** 3)
    secr = np.clip(secr, 0.0, 1.5)
    return secr


def _hepatic_production(
    insulin: float,
    stress: float,
    metformin: float,
    s_i_factor: float = 1.0,
) -> float:
    """
    Endogenous glucose production (liver), suppressed by insulin & metformin,
    increased by stress.
    """
    ins_suppr = insulin / (insulin + 25.0)          # saturating suppression
    metformin_supp = metformin * METFORMIN_EGP_SUPP
    stress_raise = 1.0 + STRESS_EGP_GAIN * stress
    egp = EGP_BASE * (1.0 - EGP_MAX_SUPPRESSION * ins_suppr)
    egp *= (1.0 - metformin_supp) * stress_raise
    return float(np.clip(egp, 0.2, 4.0))


def _effective_params(
    base: TwinParams,
    steps: float,
    sleep_state: int,
    stress: float,
    med_adherent: float,
) -> TwinParams:
    """
    Modulate latent physiology by current wearable / lifestyle inputs.
    Returns a NEW TwinParams (immutable style) with effective values.
    """
    # Activity raises both S_G and S_I
    sg_factor = 1.0 + STEPS_SG_GAIN * steps
    si_factor = 1.0 + STEPS_SI_GAIN * steps

    # Sleep quality (sleep_state: higher = deeper sleep in last window)
    # Map sleep_state (0-3) to a quality score 0-1
    sleep_q = np.clip(sleep_state / 3.0, 0.0, 1.0)
    si_factor *= 1.0 + SLEEP_SI_GAIN * (sleep_q - 0.5)

    # Stress lowers S_I
    si_factor *= 1.0 - STRESS_SI_GAIN * stress

    # Clamp factors to sane range
    sg_factor = float(np.clip(sg_factor, 0.5, 2.5))
    si_factor = float(np.clip(si_factor, 0.3, 2.0))

    return TwinParams(
        S_I=base.S_I * si_factor,
        S_G=base.S_G * sg_factor,
        k_abs=base.k_abs,
        insulin_sensitivity_factor=si_factor,
        glucose_effectiveness_factor=sg_factor,
    )


def step(
    G: float,
    X: float,
    I: float,
    Gut: float,
    params: TwinParams,
    wear: WearableInputs,
    idx: int,
    dt: float = 5.0,   # minutes per step
) -> Tuple[float, float, float, float]:
    """
    Advance the glucose-insulin ODE by one 5-minute step.

    Returns (G_new, X_new, I_new, Gut_new).
    """
    # Effective physiology for this step
    eff = _effective_params(
        params,
        steps=wear.steps_5min[idx],
        sleep_state=int(wear.sleep_state[idx]),
        stress=float(wear.stress[idx]),
        med_adherent=float(wear.med_taken[idx]),
    )

    # Meal absorption from gut
    absorption = eff.k_abs * Gut  # mg/dL/min entering plasma

    # Insulin secretion driven by plasma glucose
    secr = _insulin_secretion(np.array([G]))[0]

    # Hepatic production
    egp = _hepatic_production(
        insulin=I,
        stress=float(wear.stress[idx]),
        metformin=float(wear.med_taken[idx]),
        s_i_factor=eff.insulin_sensitivity_factor,
    )

    # Insulin-dependent disposal coefficient (min^-1)
    insulin_disposal = eff.S_I * X  # min^-1

    # ---- dG/dt (mg/dL/min) ----
    dG = (
        egp
        + absorption
        - (eff.S_G + insulin_disposal) * G
        - 0.15   # U_id: basal glucose utilization (~0.15 mg/dL/min)
    )

    # ---- dX/dt (min^-2) ----
    dX = -P2 * X + P3 * (I - I_B)

    # ---- dI/dt (muU/mL/min) ----
    dI = -N_I * (I - I_B) + secr / VI

    # ---- dGut/dt (mg/dL/min) ----
    dGut = -absorption

    # Explicit Euler integration (dt = 5 min)
    G_new = G + dG * dt
    X_new = X + dX * dt
    I_new = I + dI * dt
    Gut_new = Gut + dGut * dt

    # Clamps
    G_new = float(np.clip(G_new, G_MIN, G_MAX))
    X_new = float(np.clip(X_new, 0.0, 5.0))
    I_new = float(np.clip(I_new, 1.0, 100.0))
    Gut_new = float(np.clip(Gut_new, 0.0, 600.0))

    return G_new, X_new, I_new, Gut_new


def plasma_to_cgm(
    plasma_trace: np.ndarray,
    lag_steps: int = CGM_LAG_STEPS,
    sigma: float = CGM_NOISE_SIGMA,
    rng: Optional[np.random.Generator] = None,
) -> np.ndarray:
    """
    Convert plasma glucose to interstitial CGM: fixed delay + sensor noise.
    """
    if rng is None:
        rng = RNG
    n = len(plasma_trace)
    pad = np.full(lag_steps, G_B)
    extended = np.concatenate([pad, plasma_trace])
    cgm = extended[lag_steps : lag_steps + n]
    cgm = cgm + rng.normal(0.0, sigma, size=n)
    return np.clip(cgm, G_MIN, G_MAX)

# ── Full-patient trace simulation ──────────────────────────────────────────────

def simulate_patient_trace(
    patient_id: str,
    timestamps: np.ndarray,
    wearables: WearableInputs,
    init_params: Optional[TwinParams] = None,
    init_glucose: float = G_B,
    init_insulin: float = I_B,
    rng: Optional[np.random.Generator] = None,
) -> Trace:
    """
    Simulate one full patient trace over the given timestamps.

    Parameters
    ----------
    patient_id : str
    timestamps : np.ndarray  (datetime64 or numeric), length N
    wearables : WearableInputs  (all arrays length N)
    init_params : TwinParams  (latent physiology; uses population means if None)
    init_glucose / init_insulin : starting conditions
    rng : random generator (for sensor noise)
    """
    if rng is None:
        rng = RNG
    n = len(timestamps)
    if init_params is None:
        init_params = TwinParams()

    # Allocate traces
    g_plasma = np.empty(n, dtype=float)
    x_action = np.empty(n, dtype=float)
    insulin = np.empty(n, dtype=float)
    gut = np.empty(n, dtype=float)
    egp_trace = np.empty(n, dtype=float)
    s_i_trace = np.empty(n, dtype=float)
    s_g_trace = np.empty(n, dtype=float)
    k_abs_trace = np.empty(n, dtype=float)

    # Initial conditions
    G = init_glucose
    X = X_B
    I = init_insulin
    Gut = 0.0

    dt = 5.0  # minutes per step

    for idx in range(n):
        # Record effective params before step (for interpretability)
        eff = _effective_params(
            init_params,
            steps=float(wearables.steps_5min[idx]),
            sleep_state=int(wearables.sleep_state[idx]),
            stress=float(wearables.stress[idx]),
            med_adherent=float(wearables.med_taken[idx]),
        )
        s_i_trace[idx] = eff.S_I
        s_g_trace[idx] = eff.S_G
        k_abs_trace[idx] = eff.k_abs

        # Hepatic production for logging
        egp_trace[idx] = _hepatic_production(
            insulin=I,
            stress=float(wearables.stress[idx]),
            metformin=float(wearables.med_taken[idx]),
            s_i_factor=eff.insulin_sensitivity_factor,
        )

        g_plasma[idx] = G
        x_action[idx] = X
        insulin[idx] = I
        gut[idx] = Gut

        # Advance one step (skip integration on last step to save work)
        if idx < n - 1:
            G, X, I, Gut = step(
                G, X, I, Gut, init_params, wearables, idx, dt=dt
            )

    # CGM from plasma
    g_cgm = plasma_to_cgm(g_plasma, lag_steps=CGM_LAG_STEPS, sigma=CGM_NOISE_SIGMA, rng=rng)

    return Trace(
        timestamp=timestamps,
        patient_id=patient_id,
        glucose_plasma=g_plasma,
        glucose_cgm=g_cgm,
        glucose_gut=gut,
        insulin=insulin,
        x_action=x_action,
        egp=egp_trace,
        s_i=s_i_trace,
        s_g=s_g_trace,
        k_abs_t=k_abs_trace,
        steps=wearables.steps_5min,
        sleep=wearables.sleep_state,
        carbs=wearables.carbs_g,
        med_taken=wearables.med_taken,
        stress=wearables.stress,
        heart_rate=wearables.heart_rate,
    )


# ── Convenience: trace to DataFrame ────────────────────────────────────────────

def trace_to_dataframe(trace: Trace) -> "pd.DataFrame":
    """Convert a Trace to a pandas DataFrame matching the legacy cgm_*.parquet schema."""
    import pandas as pd

    return pd.DataFrame(
        {
            "timestamp": trace.timestamp,
            "patient_id": trace.patient_id,
            "glucose_mgdl": np.round(trace.glucose_cgm, 1),
            "heart_rate_bpm": np.round(trace.heart_rate, 1),
            "hrv_ms": np.round(60.0 - 8.0 * trace.stress + RNG.normal(0, 4, len(trace.stress)), 1),
            "steps_5min": np.round(trace.steps).astype(int),
            "sleep_state": trace.sleep,
            "carbs_g": np.round(trace.carbs, 1),
            "med_taken": trace.med_taken,
            # Physiological twin extras (not in legacy schema)
            "glucose_plasma_mgdl": np.round(trace.glucose_plasma, 1),
            "insulin_muUml": np.round(trace.insulin, 2),
            "x_action": np.round(trace.x_action, 4),
            "egp_mgdl_min": np.round(trace.egp, 3),
            "s_i": np.round(trace.s_i, 6),
            "s_g": np.round(trace.s_g, 5),
            "k_abs": np.round(trace.k_abs_t, 6),
            "stress": np.round(trace.stress, 3),
        }
    )

# ── What-if / counterfactual helper ────────────────────────────────────────────

def apply_intervention_to_wearables(
    wearables: WearableInputs,
    interventions: Dict,
    idx_from: int,
    idx_to: Optional[int] = None,
) -> WearableInputs:
    """
    Return a copy of `wearables` with interventions applied over [idx_from, idx_to).
    Intervention keys (mirror src/models/whatif.py):
        reduce_carbs_g        : subtract grams from carbs_g
        increase_steps        : add steps to steps_5min
        sleep_quality         : set sleep_state in window
        stress_level          : set stress level
        med_adherence         : set med_taken (0/1)
    """
    import copy

    w = copy.deepcopy(wearables)
    n = len(w.steps_5min)
    lo = max(0, idx_from)
    hi = n if idx_to is None else min(n, idx_to)

    if "reduce_carbs_g" in interventions:
        delta = float(interventions["reduce_carbs_g"])
        w.carbs_g[lo:hi] = np.clip(w.carbs_g[lo:hi] - delta, 0.0, None)

    if "increase_steps" in interventions:
        w.steps_5min[lo:hi] = w.steps_5min[lo:hi] + float(interventions["increase_steps"])

    if "sleep_quality" in interventions:
        sq = int(np.clip(interventions["sleep_quality"], 0, 3))
        w.sleep_state[lo:hi] = sq

    if "stress_level" in interventions:
        st = float(np.clip(interventions["stress_level"], 0.0, 1.0))
        w.stress[lo:hi] = st

    if "med_adherence" in interventions:
        w.med_taken[lo:hi] = 1.0 if float(interventions["med_adherence"]) > 0.5 else 0.0

    return w


if __name__ == "__main__":
    # Quick smoke test: simulate one patient for 1 day with a meal + activity
    import pandas as pd

    n = 288  # 1 day @ 5-min
    ts = pd.date_range("2026-01-01", periods=n, freq="5min")
    steps = np.zeros(n)
    steps[(8 * 60 // 5):(9 * 60 // 5)] = 80   # morning walk
    sleep = np.zeros(n, dtype=int)
    sleep[(22 * 60 // 5):(7 * 60 // 5)] = 2   # overnight sleep
    carbs = np.zeros(n)
    carbs[8 * 60 // 5] = 50   # breakfast
    carbs[12 * 60 // 5] = 70  # lunch
    carbs[19 * 60 // 5] = 65  # dinner
    med = np.zeros(n)
    med[8 * 60 // 5] = 1
    stress = np.full(n, 0.3)
    hr = np.full(n, 72.0)

    wear = WearableInputs(
        steps_5min=steps,
        sleep_state=sleep,
        carbs_g=carbs,
        med_taken=med,
        stress=stress,
        heart_rate=hr,
    )
    trace = simulate_patient_trace("P0001", ts.values, wear)
    df = trace_to_dataframe(trace)
    print(f"Simulated {len(df)} steps for {trace.patient_id}")
    print(f"Glucose CGM: mean={df['glucose_mgdl'].mean():.1f}, "
          f"min={df['glucose_mgdl'].min():.1f}, max={df['glucose_mgdl'].max():.1f}")
    print(f"Time >180: {(df['glucose_mgdl']>180).mean()*100:.1f}% | Time <70: {(df['glucose_mgdl']<70).mean()*100:.1f}%")
    print("[OK] glucose_model.py smoke test passed.")
    heart_rate: np.ndarray