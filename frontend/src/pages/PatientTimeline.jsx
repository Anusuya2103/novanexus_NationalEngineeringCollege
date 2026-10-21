import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import { api } from '../api.js'
import { fmt, riskColor } from '../utils/fmt.js'
import RiskBadge from '../components/RiskBadge.jsx'
import Skeleton, { SkeletonText } from '../components/Skeleton.jsx'
import ErrorCard from '../components/ErrorCard.jsx'

export default function PatientTimeline({ pid }) {
  const [profile,  setProfile]  = useState(null)
  const [windows,  setWindows]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    setLoading(true); setWindows([]); setSelected(null)
    api.getPatient(pid).then(d => {
      setProfile(d.patient)
      const maxIdx = d.latest_window?.window_index ?? 200
      const step = Math.max(1, Math.floor(maxIdx / 20))
      return Promise.all(
        Array.from({length:20}, (_,i) => api.predictById(pid, Math.min(i * step, maxIdx)).catch(() => null))
      )
    }).then(results => {
      setWindows(results.filter(Boolean))
    }).catch(e => setError(e.message))
    .finally(() => setLoading(false))
  }, [pid])

  if (error) return <ErrorCard message={error}/>

  const riskTrend = windows.map((w,i) => ({
    t: i, prob: Math.round(w.prob_mean * 100), band: w.risk_band,
  }))

  return (
    <div className="space-y-4">
      {/* EHR strip */}
      {profile && (
        <motion.div initial={{opacity:0}} animate={{opacity:1}} className="glass p-4 rounded-2xl">
          <div className="flex flex-wrap gap-6 text-sm">
            {[['Patient',profile.patient_id],['Age',`${profile.age}yr/${profile.sex}`],['HbA1c',`${profile.hba1c_pct?.toFixed(1)}%`],['BMI',profile.bmi?.toFixed(1)],['Medication',profile.medication],['DM Duration',`${profile.diabetes_duration_yrs}yr`]].map(([k,v]) => (
              <div key={k}>
                <p className="label">{k}</p>
                <p className="text-slate-200 font-medium">{v}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Risk trend */}
      <div className="glass p-4 rounded-2xl">
        <p className="text-sm font-semibold text-white mb-3">Risk Probability — 20 Windows</p>
        {loading ? <Skeleton className="h-36"/> : (
          <ResponsiveContainer width="100%" height={140} aria-label="Risk probability trend over 20 windows">
            <AreaChart data={riskTrend}>
              <defs>
                <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)"/>
              <XAxis dataKey="t" stroke="#334155" tick={{fontSize:9,fill:'#475569'}}/>
              <YAxis stroke="#334155" tick={{fontSize:9,fill:'#475569'}} domain={[0,100]} tickFormatter={v=>`${v}%`}/>
              <Tooltip formatter={(v)=>[`${v}%`,'Risk']}
                       contentStyle={{background:'#0D1526',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,fontSize:11}}/>
              <ReferenceLine y={50} stroke="#F59E0B" strokeDasharray="4 3" strokeWidth={1}/>
              <Area type="monotone" dataKey="prob" stroke="#EF4444" strokeWidth={1.5}
                    fill="url(#rg)" dot={{r:3,fill:'#EF4444',strokeWidth:0}}/>
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Window grid */}
      {loading ? (
        <div className="grid grid-cols-5 gap-2">
          {Array(10).fill(0).map((_,i) => <Skeleton key={i} className="h-24"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-2" role="list" aria-label="Window grid">
          {windows.map((w, i) => (
            <button key={i}
              className={`glass p-3 text-left rounded-2xl transition-all hover:bg-white/5 ${selected===i?'ring-1 ring-cyan-500':''}`}
              onClick={() => setSelected(selected===i ? null : i)}
              role="listitem" aria-label={`Window ${w.window_index}, ${w.risk_band} risk, ${fmt.prob(w.prob_mean)}%`}
              aria-pressed={selected===i}>
              <p className="label mb-1 text-xs">Win {w.window_index}</p>
              <p className="text-xl font-bold mono" style={{color:riskColor(w.risk_band)}}>
                {fmt.prob(w.prob_mean)}%
              </p>
              <RiskBadge band={w.risk_band}/>
              <p className="text-xs text-slate-500 mt-1">
                {w.true_label ? '● Pos' : '○ Neg'}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selected !== null && windows[selected] && (
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}
          className="glass p-5 rounded-2xl">
          <p className="text-white font-semibold mb-3">Window {windows[selected].window_index} — Detail</p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="label">Fusion Model</p>
              <p className="text-3xl font-bold mono" style={{color:riskColor(windows[selected].risk_band)}}>
                {fmt.prob(windows[selected].prob_mean)}%
              </p>
              <RiskBadge band={windows[selected].risk_band}/>
            </div>
            <div>
              <p className="label">XGBoost</p>
              <p className="text-2xl font-bold mono text-amber-400">
                {fmt.prob(windows[selected].baseline_models?.xgboost_prob)}%
              </p>
            </div>
            <div>
              <p className="label">True Label</p>
              <p className={`text-xl font-semibold ${windows[selected].true_label?'text-red-400':'text-emerald-400'}`}>
                {windows[selected].true_label ? 'Spike occurred' : 'No spike'}
              </p>
            </div>
          </div>
          {windows[selected].forecast?.length > 0 && (
            <div className="mt-4">
              <p className="label mb-2">Forecast</p>
              <div className="flex gap-6">
                {windows[selected].forecast.map(f => (
                  <div key={f.horizon_min} className="text-center">
                    <p className="text-slate-500 text-xs">+{f.horizon_min}m</p>
                    <p className="text-slate-200 mono font-medium">{fmt.glucose(f.glucose_mgdl)} mg/dL</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
