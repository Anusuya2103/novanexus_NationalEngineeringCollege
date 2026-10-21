import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api.js'
import { fmt } from '../utils/fmt.js'
import FactorBars from '../components/FactorBars.jsx'
import Skeleton, { SkeletonText } from '../components/Skeleton.jsx'
import ErrorCard from '../components/ErrorCard.jsx'

const EVENT_NAME = 'Glucose spike (>180 mg/dL within 2h)'

export default function ExplainabilityTab({ pid, winIdx }) {
  const [exp,     setExp]     = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.explainById(pid, winIdx), api.getMetrics()])
      .then(([e, m]) => { setExp(e); setMetrics(m) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pid, winIdx])

  if (error) return <ErrorCard message={error} onRetry={() => location.reload()}/>
  const fusion = metrics?.models?.fusion_full
  const stats  = exp?.window_glucose_stats ?? {}

  // Alerts from stats
  const alerts = []
  if (stats.glucose_last > 180) alerts.push({level:'red',   text:`Current glucose ${fmt.glucose(stats.glucose_last)} mg/dL — above threshold`})
  if (stats.glucose_slope_mgdl_per_15min > 2) alerts.push({level:'amber', text:`Rapid rise +${stats.glucose_slope_mgdl_per_15min?.toFixed(1)} mg/dL / 15 min`})
  if (stats.glucose_max > 180) alerts.push({level:'amber', text:`Peak ${fmt.glucose(stats.glucose_max)} mg/dL in window exceeded 180`})
  if (alerts.length === 0) alerts.push({level:'green', text:'No threshold alerts in this window'})

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Factor bars */}
      <motion.div initial={{opacity:0}} animate={{opacity:1}} className="col-span-5 flex flex-col gap-4">
        <div className="glass p-5 rounded-2xl">
          <p className="text-sm font-semibold text-white mb-1">Factor Contributions</p>
          <p className="text-xs text-slate-500 mb-4">{EVENT_NAME}</p>
          {loading ? <SkeletonText lines={7}/> : (
            <FactorBars factors={exp?.factor_contributions ?? []}/>
          )}
          <p className="text-xs text-slate-600 mt-3">
            XGBoost gain importance grouped into 7 human-readable factors. Normalised to 100%.
            Sum: {exp?.sum_check_pct?.toFixed(1)}%
          </p>
        </div>

        {/* Window stats */}
        <div className="glass p-4 rounded-2xl">
          <p className="label mb-3">Window Glucose Stats</p>
          {loading ? <SkeletonText lines={6}/> : (
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(stats).map(([k, v]) => (
                <div key={k}>
                  <p className="label text-xs">{k.replace(/_/g,' ')}</p>
                  <p className="text-slate-200 font-medium mono">
                    {typeof v === 'number' ? v.toFixed(1) : v}
                    {k.includes('glucose') && !k.includes('slope') ? ' mg/dL' : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Right column */}
      <div className="col-span-7 flex flex-col gap-4">

        {/* Alert reasoning */}
        <div className="glass p-4 rounded-2xl">
          <p className="text-sm font-semibold text-white mb-3">Alert Reasoning</p>
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className={`flex items-start gap-3 p-3 rounded-xl text-sm border ${
                a.level==='red'   ? 'bg-red-900/20 border-red-800/40 text-red-300' :
                a.level==='amber' ? 'bg-amber-900/20 border-amber-800/40 text-amber-300' :
                'bg-emerald-900/20 border-emerald-800/40 text-emerald-300'
              }`} role="alert">
                <span>{a.level==='red'?'🔴':a.level==='amber'?'🟡':'🟢'}</span>
                <span>{a.text}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-2">Alerts from model outputs only — not clinical decision rules</p>
        </div>

        {/* Model card */}
        <div className="glass p-4 rounded-2xl">
          <p className="text-sm font-semibold text-white mb-3">Model Card</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              ['Data',      '120 synthetic patients, 30d CGM, 5-min sampling'],
              ['Split',     'By patient (70/15/15) — no window leakage'],
              ['Task',      `Binary: ${EVENT_NAME}`],
              ['Model',     'BiGRU (7ch, 2L) + MLP (EHR 12f) → Fusion MLP'],
            ].map(([k,v]) => (
              <div key={k}>
                <p className="label">{k}</p>
                <p className="text-slate-300 text-xs mt-0.5">{v}</p>
              </div>
            ))}
            {fusion && (
              <>
                <div><p className="label">AUROC (test)</p><p className="text-cyan-400 font-semibold mono">{fmt.metric(fusion.auroc)}</p></div>
                <div><p className="label">AUPRC (test)</p><p className="text-cyan-400 font-semibold mono">{fmt.metric(fusion.auprc)}</p></div>
                <div><p className="label">F1</p><p className="text-cyan-400 font-semibold mono">{fmt.metric(fusion.f1)}</p></div>
                <div><p className="label">ECE</p><p className="text-amber-400 font-semibold mono">{fmt.metric(fusion.ece)}</p></div>
              </>
            )}
            <div className="col-span-2">
              <p className="label mb-1">Limitations</p>
              <p className="text-slate-400 text-xs leading-relaxed">
                Trained on synthetic data only. Wearable streams are rule-based (not validated).
                XGBoost outperforms GRU by 2.6 pp AUROC — expected on low-noise synthetic data.
                Forecast head undertrained (λ=0.01); linear extrapolation used in UI.
                Monotonicity sanity tests FAIL on this dataset. Not validated for clinical use.
              </p>
            </div>
          </div>
        </div>

        {/* Top raw features */}
        {exp?.global_feature_importance && (
          <div className="glass p-4 rounded-2xl">
            <p className="label mb-3">Top Raw Features (XGBoost Gain)</p>
            <div className="space-y-1">
              {Object.entries(exp.global_feature_importance).slice(0, 10).map(([k, v], i) => {
                const max = Object.values(exp.global_feature_importance)[0] || 1
                return (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-600 w-4 text-right">{i+1}</span>
                    <span className="text-slate-400 w-36 truncate" title={k}>{k}</span>
                    <div className="flex-1 bg-white/5 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-cyan-500/50" style={{width:`${(v/max)*100}%`}}/>
                    </div>
                    <span className="mono text-slate-500 w-10 text-right">{v.toFixed(3)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
