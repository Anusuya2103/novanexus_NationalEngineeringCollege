/**
 * Overview — 3-col (3/6/3) layout + full-width bottom strip.
 * No hardcoded numbers — everything from API.
 */
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api.js'
import { fmt, riskColor } from '../utils/fmt.js'
import { useWhatIf } from '../hooks/useWhatIf.js'
import { useStream } from '../hooks/useStream.js'
import Skeleton, { SkeletonText } from '../components/Skeleton.jsx'
import ErrorCard from '../components/ErrorCard.jsx'
import RiskBadge from '../components/RiskBadge.jsx'
import AboveThresholdBadge from '../components/AboveThresholdBadge.jsx'
import PredictionCard from '../components/PredictionCard.jsx'
import FactorBars from '../components/FactorBars.jsx'
import AlertCenter from '../components/AlertCenter.jsx'
import BodyTwin from '../components/BodyTwin.jsx'
import FutureChart from '../components/FutureChart.jsx'
import FusionFlow from '../components/FusionFlow.jsx'
import WearableTile from '../components/WearableTile.jsx'
import ComparisonStrip from '../components/ComparisonStrip.jsx'
import Spinner from '../components/Spinner.jsx'

const EVENT_NAME = 'Glucose spike (>180 mg/dL within 2h)'
const DEFAULT_INTERVENTIONS = { reduce_carbs_g: 30, increase_steps: 500 }

// EHR out-of-range thresholds
const OOR = { hba1c_pct:{ hi:7, label:'HbA1c' }, bmi:{ hi:30, label:'BMI' }, sbp_mmhg:{ hi:140, label:'SBP' } }

export default function Overview({ pid, winIdx }) {
  const [profile,  setProfile]  = useState(null)
  const [predict,  setPredict]  = useState(null)
  const [foreData, setForeData] = useState(null)
  const [explainD, setExplainD] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [wiInterv, setWiInterv] = useState(DEFAULT_INTERVENTIONS)

  const { data: wiData, loading: wiLoading, run: runWhatIf } = useWhatIf(pid)
  const streamPoints = useStream(pid, true)

  const load = useCallback(async () => {
    if (!pid) return
    setLoading(true); setError(null)
    try {
      const [prof, pred, exp] = await Promise.all([
        api.getPatient(pid),
        api.predictById(pid, winIdx),
        api.explainById(pid, winIdx),
      ])
      setProfile(prof.patient)
      setPredict(pred)
      setExplainD(exp)

      // Forecast via sample window (needs raw vectors)
      const win = await api.sampleWindow(pid)
      const fore = await api.forecast({ x_ts_flat: win.x_ts_flat, x_ehr: win.x_ehr, n_mc: 15 })
      setForeData(fore)

      // Default what-if
      await runWhatIf(DEFAULT_INTERVENTIONS)
    } catch(e) { setError(e.message) }
    finally   { setLoading(false) }
  }, [pid, winIdx])

  useEffect(() => { load() }, [load])

  // Current glucose from stream (latest point) or from window stats
  const streamGlucose = streamPoints.at(-1)?.glucose_mgdl
  const currentGlucose = streamGlucose ?? explainD?.window_glucose_stats?.glucose_last ?? 0
  const glucoseHistory = streamPoints.length >= 6
    ? streamPoints.map(p => p.glucose_mgdl)
    : foreData?.display_series?.historical?.map(h => h.glucose_mgdl) ?? []

  const prob = predict?.prob_mean ?? 0
  const band = predict?.risk_band ?? 'Low'

  // Metabolic state label
  const metabolicState = currentGlucose > 250 ? 'Hyperglycaemia' :
                         currentGlucose > 180 ? 'Above threshold' :
                         currentGlucose < 70  ? 'Hypoglycaemia'  : 'Normal'

  if (error) return <ErrorCard message={error} onRetry={load}/>

  const fadeIn = (delay=0) => ({initial:{opacity:0,y:8},animate:{opacity:1,y:0},transition:{duration:0.3,delay}})

  return (
    <div className="flex flex-col gap-4">
      {/* 3-column grid: 3 / 6 / 3 */}
      <div className="grid grid-cols-12 gap-4 items-start">

        {/* ── LEFT (3 cols) ── */}
        <motion.div {...fadeIn(0)} className="col-span-3 flex flex-col gap-3">

          {/* EHR Profile */}
          <div className="glass p-4" role="region" aria-label="EHR Profile">
            <p className="label mb-3">EHR Profile</p>
            {loading ? <SkeletonText lines={7}/> : (
              <dl className="space-y-2 text-sm">
                {[
                  ['Patient',    profile?.patient_id],
                  ['Age / Sex',  `${profile?.age ?? '?'} yr / ${profile?.sex ?? '?'}`],
                  ['BMI',        profile?.bmi?.toFixed(1),            profile?.bmi > 30],
                  ['HbA1c',      (profile?.hba1c_pct?.toFixed(1))+' %', profile?.hba1c_pct > 7],
                  ['BP',         `${profile?.sbp_mmhg}/${profile?.dbp_mmhg} mmHg`, profile?.sbp_mmhg > 140],
                  ['Medication', profile?.medication],
                  ['DM Duration',`${profile?.diabetes_duration_yrs} yr`],
                  ['Prior events 90d', profile?.prior_hyper_events_90d],
                ].map(([k, v, oor]) => (
                  <div key={k} className="flex justify-between items-start">
                    <dt className="text-slate-500 shrink-0">{k}</dt>
                    <dd className="text-slate-200 font-medium text-right flex items-center gap-1">
                      {oor && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Out of range" aria-label="Out of range"/>}
                      {v ?? '—'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* Live Wearables 2×3 grid */}
          <div role="region" aria-label="Live wearables">
            <p className="label mb-2">Live Wearables</p>
            <div className="grid grid-cols-2 gap-2">
              {loading ? Array(6).fill(0).map((_,i)=><Skeleton key={i} className="h-20"/>) : [
                { label:'Glucose',      value: fmt.glucose(currentGlucose),          unit:'mg/dL', color:'#22D3EE', data: glucoseHistory, trend: explainD?.window_glucose_stats?.glucose_slope_mgdl_per_15min, above: currentGlucose > 180 },
                { label:'Heart Rate',   value: streamPoints.at(-1)?.heart_rate_bpm ? Math.round(streamPoints.at(-1).heart_rate_bpm) : '—', unit:'bpm', color:'#F472B6', data: streamPoints.map(p=>p.heart_rate_bpm).filter(Boolean) },
                { label:'HRV',          value: streamPoints.at(-1)?.hrv_ms ? Math.round(streamPoints.at(-1).hrv_ms) : '—', unit:'ms', color:'#8B5CF6', data: streamPoints.map(p=>p.hrv_ms).filter(Boolean) },
                { label:'Steps',        value: streamPoints.at(-1)?.steps_5min ? Math.round(streamPoints.at(-1).steps_5min) : '—', unit:'/15m', color:'#34D399', data: streamPoints.map(p=>p.steps_5min).filter(Boolean) },
                { label:'Sleep',        value: streamPoints.at(-1)?.sleep_state ?? '—', unit:'state', color:'#60A5FA', data: streamPoints.map(p=>p.sleep_state).filter(Boolean) },
                { label:'Stress proxy', value: streamPoints.at(-1)?.hrv_ms ? (44 - streamPoints.at(-1).hrv_ms > 0 ? 'Elevated' : 'Normal') : '—', unit:'', color:'#FB923C', data:[] },
              ].map(w => (
                <WearableTile key={w.label} {...w}/>
              ))}
            </div>
          </div>

          {/* Data Fusion flow */}
          <div className="glass p-3" role="region" aria-label="Data fusion pipeline">
            <p className="label mb-2">Data Fusion</p>
            <FusionFlow active="prediction"/>
          </div>
        </motion.div>

        {/* ── CENTER (6 cols) ── */}
        <motion.div {...fadeIn(0.05)} className="col-span-6 flex flex-col gap-3">

          {/* Twin card */}
          <div className="glass p-4 flex items-start gap-5" style={{minHeight:'220px'}}
               role="region" aria-label="Digital twin visualization">
            {loading ? <Skeleton className="w-48 h-52"/> : (
              <BodyTwin
                band={band}
                prob={prob}
                currentGlucose={currentGlucose}
                metabolicState={metabolicState}
                patientName={pid}
                patientAge={profile?.age}
                patientSex={profile?.sex}
                photoUrl={null}
                explainFactors={{
                  hr_and_hrv:           explainD?.factors?.hr_and_hrv            ?? 0,
                  recent_glucose_trend: explainD?.factors?.recent_glucose_trend  ?? 0,
                  sleep:                explainD?.factors?.sleep                  ?? 0,
                  meal_and_carbs:       explainD?.factors?.meal_and_carbs         ?? 0,
                  ehr_context:          explainD?.factors?.ehr_context            ?? 0,
                  activity:             explainD?.factors?.activity               ?? 0,
                }}
              />
            )}
            <div className="flex-1">
              <p className="label mb-1">Event Definition</p>
              <p className="text-base font-semibold text-white leading-snug">{EVENT_NAME}</p>
              <p className="text-xs text-slate-500 mt-1.5">Threshold: 180 mg/dL · 2-hour horizon</p>

              <div className="mt-3 flex flex-wrap gap-2">
                {loading ? <Skeleton className="w-20 h-6"/> : <RiskBadge band={band} size="lg"/>}
                {!loading && currentGlucose > 180 && <AboveThresholdBadge glucose={currentGlucose}/>}
              </div>

              {/* Compact indicator rows */}
              {!loading && explainD && (
                <div className="mt-3 space-y-1.5 text-xs" role="list" aria-label="Model-derived indicators">
                  {[
                    ['Glucose variability', explainD.window_glucose_stats?.glucose_std > 20 ? 'High' : 'Normal',
                     explainD.window_glucose_stats?.glucose_std > 20],
                    ['Trend', explainD.window_glucose_stats?.glucose_slope_mgdl_per_15min > 1.5 ? `↑ +${explainD.window_glucose_stats.glucose_slope_mgdl_per_15min.toFixed(1)}/15m` : '→ Stable',
                     explainD.window_glucose_stats?.glucose_slope_mgdl_per_15min > 1.5],
                    ['Activity', explainD.factors?.activity > 12 ? 'Active' : 'Low', false],
                    ['Recovery', explainD.factors?.sleep > 12 ? 'Good' : 'Poor', explainD.factors?.sleep <= 8],
                  ].map(([label, val, warn]) => (
                    <div key={label} className="flex justify-between" role="listitem">
                      <span className="text-slate-500">{label}</span>
                      <span className={warn ? 'text-amber-400' : 'text-slate-300'}>{val}</span>
                    </div>
                  ))}
                  <p className="text-slate-700 text-xs">model-derived indicators, not anatomical</p>
                </div>
              )}
            </div>
          </div>

          {/* Future Window Chart — the signature element */}
          <div className="glass p-4 flex-1" role="region" aria-label="Glucose history and forecast chart">
            {loading ? <Skeleton className="h-64"/> : (
              <FutureChart
                displaySeries={foreData?.display_series}
                trueLabel={predict?.true_label}
                title="Glucose History + Forecast"
              />
            )}
          </div>
        </motion.div>

        {/* ── RIGHT (3 cols) ── */}
        <motion.div {...fadeIn(0.10)} className="col-span-3 flex flex-col gap-3">

          {/* Clinician header */}
          <div className="glass p-3 flex items-center justify-between"
               role="region" aria-label="Patient header">
            <div>
              <p className="text-white font-semibold">{pid}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Win #{predict?.window_index ?? '—'} · <span className="text-emerald-400">Twin: LIVE</span>
              </p>
            </div>
            {loading ? <Skeleton className="w-16 h-5"/> : <RiskBadge band={band}/>}
          </div>

          {/* PREDICTION CARD — largest number on screen */}
          {loading ? <Skeleton className="h-44"/> : (
            <PredictionCard predict={predict} currentGlucose={currentGlucose}/>
          )}

          {/* Why this prediction */}
          <div className="glass p-4" role="region" aria-label="Factor contributions">
            {loading ? <SkeletonText lines={7}/> : (
              <FactorBars factors={explainD?.factor_contributions ?? []}/>
            )}
          </div>

          {/* Early warnings */}
          <div className="glass p-4" role="region" aria-label="Early warning center">
            {loading ? <SkeletonText lines={4}/> : (
              <AlertCenter predict={predict} explainData={explainD} profile={profile}/>
            )}
          </div>

          {/* Next Best Action */}
          <div className="glass p-3" role="region" aria-label="Next best actions">
            <p className="label mb-2">Next Best Action</p>
            <div className="space-y-1">
              {[
                { icon:'🚶', text:'Walk 20 min (+1000 steps)',  interv:{ increase_steps: 1000 },            label:'30-min post-meal walk' },
                { icon:'🥗', text:'Reduce meal carbs 30g',      interv:{ reduce_carbs_g: 30 },              label:'Lower-carb meal' },
                { icon:'💊', text:'Take scheduled medication',  interv:{ add_medication: true },            label:'Medication adherence' },
                { icon:'😴', text:'Improve sleep quality',      interv:{ sleep_quality: 2 },                label:'Better sleep' },
              ].map(action => (
                <button key={action.text}
                  className="btn-ghost w-full text-left text-xs"
                  disabled={wiLoading}
                  onClick={async () => {
                    setWiInterv(action.interv)
                    await runWhatIf(action.interv)
                  }}
                  aria-label={`Simulate: ${action.text}`}>
                  <span>{action.icon}</span>
                  <span className="flex-1">{action.text}</span>
                  {wiLoading ? <Spinner size="sm"/> : (
                    <span className="text-slate-600">Simulate →</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* BOTTOM STRIP */}
      {!loading && (
        <ComparisonStrip
          wiData={wiData}
          interventionLabel={
            wiInterv.increase_steps && wiInterv.reduce_carbs_g
              ? '30-min post-meal walk + lower-carb meal'
              : wiInterv.increase_steps ? '+1000 steps'
              : wiInterv.reduce_carbs_g ? `Reduce carbs ${wiInterv.reduce_carbs_g}g`
              : 'Custom intervention'
          }
        />
      )}
    </div>
  )
}
