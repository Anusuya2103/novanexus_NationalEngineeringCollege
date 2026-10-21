/**
 * ModelMetrics — detailed evaluation page.
 * Shows ROC/calibration plot images from results/plots/ served via API,
 * confusion matrix numbers, forecast MAE/RMSE, and full metrics JSON.
 */
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import Spinner from '../components/Spinner.jsx'
import StatCard from '../components/StatCard.jsx'
import {
  ResponsiveContainer, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Tooltip as RTooltip
} from 'recharts'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const MODEL_LABELS = {
  fusion_full:               'Full Fusion',
  ablation_glucose_only:     'Glucose only',
  ablation_wearables_no_ehr: '+Wearables',
  xgboost:                   'XGBoost',
  logreg:                    'LogReg',
}

function ConfusionMatrix({ cm }) {
  if (!cm) return null
  const { tp, fp, tn, fn } = cm
  const total = tp + fp + tn + fn
  const cells = [
    { label: 'TN', v: tn, color: 'bg-green-900/40 text-green-300' },
    { label: 'FP', v: fp, color: 'bg-red-900/40  text-red-300'   },
    { label: 'FN', v: fn, color: 'bg-amber-900/40 text-amber-300' },
    { label: 'TP', v: tp, color: 'bg-green-900/60 text-green-200' },
  ]
  return (
    <div>
      <p className="label mb-2">Confusion Matrix (Full Fusion)</p>
      <div className="grid grid-cols-2 gap-1 w-40">
        {cells.map(c => (
          <div key={c.label} className={`${c.color} rounded p-3 text-center`}>
            <p className="text-xs opacity-70">{c.label}</p>
            <p className="font-bold tabular-nums">{c.v?.toLocaleString()}</p>
            <p className="text-xs opacity-60">{total ? (c.v/total*100).toFixed(1)+'%' : ''}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-2">Predicted → | Actual ↓</p>
    </div>
  )
}

function ForecastTable({ forecast }) {
  if (!forecast) return null
  return (
    <div>
      <p className="label mb-2">Forecast MAE / RMSE</p>
      <table className="text-sm w-full">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="text-left py-1 px-2 label">Horizon</th>
            <th className="text-right py-1 px-2 label">MAE (mg/dL)</th>
            <th className="text-right py-1 px-2 label">RMSE (mg/dL)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(forecast).map(([h, v]) => (
            <tr key={h} className="border-b border-slate-800/40">
              <td className="py-1 px-2 text-slate-300">{h}</td>
              <td className="py-1 px-2 text-right tabular-nums text-slate-200">{v.mae}</td>
              <td className="py-1 px-2 text-right tabular-nums text-slate-200">{v.rmse}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 mt-1">
        Note: Forecast head was under-trained (lambda=0.01). Linear extrapolation used in UI.
      </p>
    </div>
  )
}

function RadarComp({ models }) {
  const metrics = ['auroc', 'auprc', 'f1', 'recall', 'precision', 'specificity']
  const data = metrics.map(m => {
    const row = { metric: m.toUpperCase() }
    Object.entries(MODEL_LABELS).forEach(([k, label]) => {
      row[label] = models[k]?.[m] ?? 0
    })
    return row
  })
  const COLORS = ['#38bdf8','#f59e0b','#a78bfa','#34d399','#fb923c']

  return (
    <div>
      <p className="label mb-2">Model Comparison Radar</p>
      <ResponsiveContainer width="100%" height={260}>
        <RadarChart data={data}>
          <PolarGrid stroke="#1e293b"/>
          <PolarAngleAxis dataKey="metric" tick={{ fill: '#64748b', fontSize: 10 }}/>
          <PolarRadiusAxis angle={90} domain={[0.7, 1]} tick={{ fill: '#475569', fontSize: 8 }}/>
          {Object.values(MODEL_LABELS).map((label, i) => (
            <Radar key={label} name={label} dataKey={label}
                   stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.08}
                   strokeWidth={1.5}/>
          ))}
          <RTooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#94a3b8' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function ModelMetrics() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState(null)

  useEffect(() => {
    api.getMetrics()
      .then(setMetrics)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg"/></div>
  if (err)     return <div className="text-red-400 text-center py-20">API error: {err}</div>

  const { models } = metrics
  const fusion = models.fusion_full

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Model Evaluation</h1>
        <p className="text-slate-400 text-sm">
          All metrics read from <code className="text-brand-400">results/metrics.json</code> — real model outputs, never hardcoded.
        </p>
      </div>

      {/* Full Fusion headline stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
        {[
          ['AUROC',       fusion.auroc?.toFixed(4),       'text-brand-400'],
          ['AUPRC',       fusion.auprc?.toFixed(4),       'text-brand-400'],
          ['F1',          fusion.f1?.toFixed(4),          'text-brand-400'],
          ['Precision',   fusion.precision?.toFixed(4),   'text-slate-200'],
          ['Recall',      fusion.recall?.toFixed(4),      'text-slate-200'],
          ['Specificity', fusion.specificity?.toFixed(4), 'text-slate-200'],
        ].map(([l, v, c]) => (
          <StatCard key={l} label={l} value={v} color={c} sub="Full Fusion"/>
        ))}
      </div>

      {/* Radar + Confusion + Forecast */}
      <div className="grid md:grid-cols-3 gap-6">
        <div className="card md:col-span-1">
          <RadarComp models={models}/>
        </div>
        <div className="card flex flex-col gap-6">
          <ConfusionMatrix cm={fusion.confusion_matrix}/>
          <div>
            <p className="label mb-1">Calibration ECE</p>
            <p className="text-2xl font-bold text-amber-400 tabular-nums">{fusion.ece?.toFixed(4)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Expected calibration error (15 bins). Lower is better.</p>
          </div>
        </div>
        <div className="card">
          <ForecastTable forecast={fusion.forecast}/>
        </div>
      </div>

      {/* Plot images served from API */}
      <div className="grid md:grid-cols-3 gap-6">
        {[
          ['ROC Curves',              `${API_BASE}/static/roc_curve.png`],
          ['Calibration Curve',       `${API_BASE}/static/calibration_curve.png`],
          ['Confusion Matrix (plot)', `${API_BASE}/static/confusion_matrix.png`],
        ].map(([title, src]) => (
          <div key={title} className="card">
            <p className="label mb-2">{title}</p>
            <img src={src} alt={title}
                 className="w-full rounded-lg bg-slate-800"
                 onError={e => { e.target.style.display='none' }}/>
          </div>
        ))}
      </div>

      {/* XGB feature importance plot */}
      <div className="grid md:grid-cols-2 gap-6">
        {[
          ['XGBoost Feature Importance', `${API_BASE}/static/shap_bar.png`],
          ['GRU Saliency Map',           `${API_BASE}/static/gru_saliency.png`],
        ].map(([title, src]) => (
          <div key={title} className="card">
            <p className="label mb-2">{title}</p>
            <img src={src} alt={title}
                 className="w-full rounded-lg bg-slate-800"
                 onError={e => { e.target.style.display='none' }}/>
          </div>
        ))}
      </div>
    </div>
  )
}
