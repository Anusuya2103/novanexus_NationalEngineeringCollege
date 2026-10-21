import { useEffect, useState } from 'react'
import { ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Tooltip } from 'recharts'
import { api, API_BASE } from '../api.js'
import { fmt } from '../utils/fmt.js'
import Skeleton, { SkeletonText } from '../components/Skeleton.jsx'
import ErrorCard from '../components/ErrorCard.jsx'

const MODEL_ORDER = [
  ['ablation_glucose_only',     'GRU — glucose only'],
  ['ablation_wearables_no_ehr', 'GRU + Wearables'],
  ['fusion_full',               'Full Fusion (GRU+EHR)'],
  ['xgboost',                   'XGBoost'],
  ['logreg',                    'Logistic Regression'],
]
const COLORS = ['#22D3EE','#F59E0B','#8B5CF6','#34D399','#F472B6']

export default function ModelReport() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    api.getMetrics().then(setMetrics).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  if (error) return <ErrorCard message={error}/>
  if (loading) return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-3">{Array(6).fill(0).map((_,i)=><Skeleton key={i} className="h-20"/>)}</div>
      <Skeleton className="h-64"/>
    </div>
  )
  if (!metrics) return <div className="text-slate-500 text-center py-12">Run <code className="font-mono">make evaluate</code> to generate metrics</div>

  const { models, dataset_info, honest_comparison, sanity_tests } = metrics
  const fusion = models?.fusion_full ?? {}

  const radarData = ['auroc','auprc','f1','precision','recall','specificity'].map(m => {
    const row = { metric: m.toUpperCase() }
    MODEL_ORDER.forEach(([k, label]) => { row[label] = models[k]?.[m] ?? 0 })
    return row
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white mb-1">Model Evaluation Report</h1>
        <p className="text-slate-400 text-sm">All values from <code className="text-cyan-400 mono">results/metrics.json</code> — real outputs, never hardcoded.</p>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[['AUROC','auroc','text-cyan-400'],['AUPRC','auprc','text-cyan-400'],['F1','f1','text-cyan-400'],['Precision','precision','text-slate-200'],['Recall','recall','text-slate-200'],['ECE','ece','text-amber-400']].map(([l,k,c]) => (
          <div key={l} className="glass p-4 rounded-2xl text-center">
            <p className="label mb-1">{l}</p>
            <p className={`text-2xl font-bold mono ${c}`}>{fmt.metric(fusion[k])}</p>
            <p className="text-xs text-slate-600 mt-0.5">Full Fusion</p>
          </div>
        ))}
      </div>

      {/* Honest comparison */}
      {honest_comparison && (
        <div className={`glass p-4 rounded-2xl border ${honest_comparison.diff_percentage_points>=0?'border-emerald-800/40':'border-amber-800/40'}`}>
          <p className="font-semibold text-white mb-1">Honest Model Comparison</p>
          <p className="text-sm text-slate-300">{honest_comparison.note}</p>
          <div className="flex gap-6 mt-2 text-xs text-slate-500">
            <span>Fusion AUROC: <b className="text-cyan-400 mono">{honest_comparison.fusion_auroc}</b></span>
            <span>XGBoost AUROC: <b className="text-amber-400 mono">{honest_comparison.xgboost_auroc}</b></span>
            <span>Diff: <b className={`mono ${honest_comparison.diff_percentage_points>=0?'text-emerald-400':'text-amber-400'}`}>{honest_comparison.diff_percentage_points > 0?'+':''}{honest_comparison.diff_percentage_points} pp</b></span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Ablation table */}
        <div className="glass p-5 rounded-2xl">
          <p className="text-white font-semibold mb-3">Ablation Table</p>
          <table className="w-full text-sm" role="table" aria-label="Model ablation results">
            <thead>
              <tr className="border-b border-white/5">
                {['Model','AUROC','AUPRC','F1','ECE'].map(h => <th key={h} className="text-left py-2 label">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {MODEL_ORDER.map(([key, label], i) => {
                const m = models[key]; if (!m) return null
                const best = Math.max(...MODEL_ORDER.map(([k])=>models[k]?.auroc??0))
                return (
                  <tr key={key} className={`border-b border-white/5 ${m.auroc===best?'bg-white/5':''}`}>
                    <td className="py-2 pr-2 font-medium text-xs" style={{color:COLORS[i]}}>
                      {label}{m.auroc===best&&<span className="text-xs text-cyan-400 ml-1">★</span>}
                    </td>
                    <td className="py-2 mono text-slate-200 text-xs">{fmt.metric(m.auroc)}</td>
                    <td className="py-2 mono text-slate-300 text-xs">{fmt.metric(m.auprc)}</td>
                    <td className="py-2 mono text-slate-300 text-xs">{fmt.metric(m.f1)}</td>
                    <td className="py-2 mono text-slate-400 text-xs">{m.ece ? fmt.metric(m.ece) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Radar */}
        <div className="glass p-4 rounded-2xl">
          <p className="label mb-2">Model Radar</p>
          <ResponsiveContainer width="100%" height={220} aria-label="Model comparison radar chart">
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.05)"/>
              <PolarAngleAxis dataKey="metric" tick={{fill:'#475569',fontSize:9}}/>
              <PolarRadiusAxis angle={90} domain={[0.7,1]} tick={{fill:'#334155',fontSize:8}}/>
              {MODEL_ORDER.map(([,label],i) => (
                <Radar key={label} name={label} dataKey={label}
                       stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.06} strokeWidth={1.5}/>
              ))}
              <Tooltip contentStyle={{background:'#0D1526',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,fontSize:10}}/>
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sanity tests */}
      {sanity_tests && (
        <div className="glass p-5 rounded-2xl">
          <p className="text-white font-semibold mb-3">Monotonicity Sanity Tests</p>
          <div className="space-y-3">
            {Object.entries(sanity_tests).map(([key, r]) => (
              <div key={key} className={`p-3 rounded-xl border text-sm ${r.passed?'bg-emerald-900/15 border-emerald-800/30':'bg-amber-900/15 border-amber-800/30'}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-white">{key.replace(/_/g,' ')}</p>
                  <span className={`font-semibold ${r.passed?'text-emerald-400':'text-amber-400'}`}>{r.status}</span>
                </div>
                <p className="text-slate-400 text-xs">{r.honest_note}</p>
                <p className="text-slate-500 text-xs mt-1 mono">
                  mean Δ = {r.mean_delta_pp>0?'+':''}{r.mean_delta_pp} pp · {r.pct_windows_increased}% windows increased · n={r.n_tested}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-700 mt-2">Failures on synthetic data are expected. See README for full discussion.</p>
        </div>
      )}

      {/* Plot images */}
      <div className="grid grid-cols-3 gap-4">
        {[['ROC Curves',`${API_BASE}/static/roc_curve.png`],['Calibration Curve',`${API_BASE}/static/calibration_curve.png`],['Confusion Matrix',`${API_BASE}/static/confusion_matrix.png`]].map(([title,src]) => (
          <div key={title} className="glass p-3 rounded-2xl">
            <p className="label mb-2">{title}</p>
            <img src={src} alt={title} className="w-full rounded-xl"
                 style={{background:'#0D1526'}} onError={e=>{e.target.style.display='none'}}/>
          </div>
        ))}
      </div>

      {/* Forecast MAE/RMSE */}
      {fusion.forecast && (
        <div className="glass p-4 rounded-2xl">
          <p className="text-sm font-semibold text-white mb-3">Forecast Performance (Full Fusion)</p>
          <table className="text-sm w-full" role="table" aria-label="Forecast MAE and RMSE by horizon">
            <thead>
              <tr className="border-b border-white/5">
                {['Horizon','MAE (mg/dL)','RMSE (mg/dL)'].map(h=><th key={h} className="text-left py-2 label">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(fusion.forecast).map(([h, v]) => (
                <tr key={h} className="border-b border-white/5">
                  <td className="py-2 text-slate-300">{h}</td>
                  <td className="py-2 mono text-slate-200">{v.mae}</td>
                  <td className="py-2 mono text-slate-200">{v.rmse}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-2">Note: Forecast head undertrained (λ=0.01). Linear extrapolation used in UI.</p>
        </div>
      )}
    </div>
  )
}
