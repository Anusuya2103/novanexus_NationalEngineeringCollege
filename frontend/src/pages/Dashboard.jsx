/**
 * Dashboard — matches reference screenshot exactly.
 * 4-column layout: Patient+EHR | Digital Twin | Analytics+Wearables | Clinician Panel
 */
import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { fmt, riskColor } from '../utils/fmt.js'
import { useWhatIf } from '../hooks/useWhatIf.js'
import { useStream } from '../hooks/useStream.js'
import AnatomicalTwin from '../components/AnatomicalTwin.jsx'

// ── Mini sparkline (SVG) ───────────────────────────────────────────────────────
function Spark({ data=[], color='#22D3EE', h=28, w=72 }) {
  if (!data || data.length < 2) return <div style={{width:w,height:h,background:'rgba(255,255,255,0.04)',borderRadius:4}}/>
  const min = Math.min(...data), max = Math.max(...data), range = max-min||1
  const pts = data.map((v,i) => {
    const x = 2 + (i/(data.length-1))*(w-4)
    const y = (h-2) - ((v-min)/range)*(h-4)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
    </svg>
  )
}

// ── Mini donut / arc for health score ─────────────────────────────────────────
function HealthScore({ score=6.8, max=10 }) {
  const scoreNum = parseFloat(score) || 0
  const pct  = scoreNum / max
  const r    = 32, cx = 40, cy = 40
  const circ = 2 * Math.PI * r
  const dash = circ * pct
  return (
    <svg width="80" height="80" viewBox="0 0 80 80">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6"/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#22D3EE" strokeWidth="6"
              strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ*0.25} strokeLinecap="round"/>
      <text x={cx} y={cy+2} textAnchor="middle" dominantBaseline="middle"
            fontSize="14" fontWeight="800" fill="white" fontFamily="'JetBrains Mono',monospace">{score}</text>
      <text x={cx} y={cy+14} textAnchor="middle" fontSize="7" fill="#64748B" fontFamily="Inter,sans-serif">/10</text>
    </svg>
  )
}

// ── Alert row ─────────────────────────────────────────────────────────────────
function AlertRow({ level, title, desc, time }) {
  const cfg = ({
    CRITICAL: { bg:'rgba(239,68,68,0.1)',  border:'rgba(239,68,68,0.35)',  dot:'#EF4444', lbl:'CRITICAL' },
    WARNING:  { bg:'rgba(245,158,11,0.1)', border:'rgba(245,158,11,0.35)', dot:'#F59E0B', lbl:'WARNING'  },
    INFO:     { bg:'rgba(34,211,238,0.08)',border:'rgba(34,211,238,0.25)', dot:'#22D3EE', lbl:'INFO'     },
  })[level] || { bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.1)', dot:'#94A3B8', lbl:'INFO' }
  return (
    <div style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:8, padding:'8px 10px', display:'flex', gap:10, alignItems:'flex-start' }}>
      <span style={{ width:7, height:7, borderRadius:'50%', background:cfg.dot, flexShrink:0, marginTop:4, display:'inline-block' }}/>
      <div style={{ flex:1 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:2 }}>
          <span style={{ color:cfg.dot, fontSize:10, fontWeight:700 }}>{cfg.lbl}</span>
          <span style={{ color:'#475569', fontSize:10 }}>{time}</span>
        </div>
        <p style={{ color:'white', fontSize:11, fontWeight:600, margin:'0 0 2px' }}>{title}</p>
        <p style={{ color:'#64748B', fontSize:10, margin:0 }}>{desc}</p>
      </div>
    </div>
  )
}

// ── Risk factor chip ──────────────────────────────────────────────────────────
function RiskFactorChip({ icon, label, sublabel, color='#F59E0B' }) {
  return (
    <div style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${color}44`, borderRadius:8, padding:'8px 10px', display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:18 }}>{icon}</span>
      <div>
        <p style={{ color:color, fontSize:11, fontWeight:700, margin:0 }}>{label}</p>
        <p style={{ color:'#475569', fontSize:10, margin:0 }}>{sublabel}</p>
      </div>
    </div>
  )
}

// ── Section header matching screenshot ───────────────────────────────────────
function SectionHeader({ icon, title, color='#22D3EE' }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
      <span style={{ fontSize:14, color }}>{icon}</span>
      <span style={{ color:'white', fontWeight:700, fontSize:12, textTransform:'uppercase', letterSpacing:'0.06em' }}>{title}</span>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard({ pid }) {
  const [profile,  setProfile]  = useState(null)
  const [predict,  setPredict]  = useState(null)
  const [explainD, setExplainD] = useState(null)
  const [foreData, setForeData] = useState(null)
  const [metrics,  setMetrics]  = useState(null)
  const [loading,  setLoading]  = useState(true)

  // What-if state
  // Slider defaults seeded from patient EHR data once loaded
  const [carbs,      setCarbs]     = useState(180)
  const [steps,      setSteps]     = useState(5000)
  const [metDose,    setMetDose]   = useState(500)
  const [slidersSeeded, setSlidersSeeded] = useState(false)
  const [simResult,  setSimResult] = useState(null)
  const [simLoading, setSimLoading]= useState(false)
  const { run: runWhatIf } = useWhatIf(pid)
  const streamPts = useStream(pid, true)

  const load = useCallback(async () => {
    if (!pid) return
    setLoading(true)
    try {
      const [prof, pred, exp, met] = await Promise.all([
        api.getPatient(pid),
        api.predictById(pid),
        api.explainById(pid),
        api.getMetrics(),
      ])
      setProfile(prof.patient)
      // Seed slider defaults from patient EHR data (only once)
      if (!slidersSeeded) {
        // Carbs: infer from HbA1c — higher HbA1c suggests higher carb intake
        const hba1c = prof.patient?.hba1c_pct ?? 7.5
        setCarbs(Math.round(Math.min(280, Math.max(80, 50 + hba1c * 18))))
        // Steps: infer from BMI — higher BMI suggests lower activity
        const bmi = prof.patient?.bmi ?? 28
        setSteps(Math.round(Math.max(2000, Math.min(12000, 15000 - bmi * 250))))
        // Metformin dose: from medication field
        const med = prof.patient?.medication ?? ''
        setMetDose(med.includes('Metformin') ? 1000 : med.includes('Insulin') ? 500 : 750)
        setSlidersSeeded(true)
      }
      setPredict(pred)
      setExplainD(exp)
      setMetrics(met)
      const win = await api.sampleWindow(pid)
      const fore = await api.forecast({ x_ts_flat: win.x_ts_flat, x_ehr: win.x_ehr, n_mc: 10 })
      setForeData(fore)
    } catch(e) { console.error(e) }
    setLoading(false)
  }, [pid])

  useEffect(() => { load() }, [load])

  // What-if run
  const runSim = async () => {
    setSimLoading(true)
    try {
      const r = await api.whatifById(pid, {
        interventions: {
          reduce_carbs_g: Math.max(0, 300 - carbs),
          increase_steps: steps,
          add_medication: metDose >= 1000,
        }, n_mc: 10
      })
      setSimResult(r)
    } catch {}
    setSimLoading(false)
  }

  // Stream data
  const lastStream = streamPts.at(-1)
  const streamGlucose = lastStream?.glucose_mgdl
  const currentGlucose = streamGlucose ?? explainD?.window_glucose_stats?.glucose_last ?? 0
  const glucoseArr  = streamPts.length >= 4 ? streamPts.map(p=>p.glucose_mgdl) : (foreData?.display_series?.historical?.map(h=>h.glucose_mgdl) ?? [])
  const hrArr       = streamPts.map(p=>p.heart_rate_bpm).filter(Boolean)
  const stepsArr    = streamPts.map(p=>p.steps_5min).filter(Boolean)
  const sleepArr    = streamPts.map(p=>p.sleep_state).filter(Boolean)

  const prob  = predict?.prob_mean ?? 0
  const band  = predict?.risk_band ?? 'Low'
  const col   = riskColor(band)
  const metabolicState = currentGlucose > 250 ? 'Hyperglycaemia' : currentGlucose > 180 ? 'Above threshold' : currentGlucose < 70 ? 'Hypoglycaemia' : 'Normal'
  const patInitials = pid ? pid.replace(/\D/g,'').slice(0,2) || pid.slice(0,2).toUpperCase() : '?'

  // Alerts from model
  const alerts = []
  if (currentGlucose > 180) alerts.push({ level:'CRITICAL', title:'Glucose spike imminent', desc:'Based on current trend and historical pattern', time:'Now' })
  if ((predict?.prob_mean ?? 0) > 0.7) alerts.push({ level:'WARNING', title:'High risk prediction', desc:`Model probability ${fmt.prob(predict?.prob_mean)}%`, time:'Now' })
  if ((explainD?.factors?.sleep ?? 0) < 8) alerts.push({ level:'INFO', title:'Sleep quality below target', desc:'May impact glucose control', time:'Earlier' })
  if (alerts.length === 0) alerts.push({ level:'INFO', title:'All parameters within range', desc:'No active alerts', time:'Now' })

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1.6fr 1fr 1fr', gap:14, height:'calc(100vh - var(--topbar-h) - 56px)', overflow:'hidden' }}>

      {/* ══ COL 1: Patient Profile + EHR + Wearables ══ */}
      <div style={{ display:'flex', flexDirection:'column', gap:10, overflow:'auto', paddingRight:2 }}>

        {/* Patient Profile */}
        <div className="card" style={{ padding:14 }}>
          <SectionHeader icon="👤" title="Patient Profile"/>
          <div style={{ display:'flex', gap:10, marginBottom:10 }}>
            {/* Photo placeholder */}
            <div style={{ width:56, height:56, borderRadius:'50%', background:'linear-gradient(135deg,#1e3a5f,#0f2040)', border:'2px solid rgba(34,211,238,0.4)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, overflow:'hidden' }}>
              <span style={{ color:'#22D3EE', fontWeight:800, fontSize:18, fontFamily:'monospace' }}>{patInitials}</span>
            </div>
            <div>
              <p style={{ color:'white', fontWeight:700, fontSize:14, margin:'0 0 2px' }}>{profile?.patient_id ?? pid}</p>
              <p style={{ color:'#94A3B8', fontSize:11, margin:'0 0 1px' }}>Age: {profile?.age ?? '?'} | {profile?.sex ?? '?'} | T2DM</p>
              <p style={{ color:'#94A3B8', fontSize:11, margin:'0 0 1px' }}>BMI: {profile?.bmi?.toFixed(1)} ({(profile?.bmi ?? 0) > 30 ? 'Overweight' : 'Normal'})</p>
              <p style={{ color:'#475569', fontSize:10, margin:0 }}>Diabetes since {profile?.diabetes_duration_yrs ? new Date().getFullYear() - profile.diabetes_duration_yrs : '?'}</p>
            </div>
          </div>
          {/* Digital Twin badge */}
          <div style={{ background:'rgba(34,211,238,0.08)', border:'1px solid rgba(34,211,238,0.2)', borderRadius:6, padding:'5px 10px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ color:'#64748B', fontSize:10 }}>Patient ID: {pid}</span>
            <span style={{ color:'#22D3EE', fontSize:10, fontWeight:700 }}>Digital Twin</span>
          </div>
        </div>

        {/* EHR Summary */}
        <div className="card" style={{ padding:14, flex:1, overflow:'auto' }}>
          <SectionHeader icon="📋" title="EHR Summary"/>

          <div style={{ marginBottom:10 }}>
            <p style={{ color:'#22D3EE', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>Diagnoses</p>
            <p style={{ color:'#CBD5E1', fontSize:11, margin:'1px 0' }}>Type 2 Diabetes</p>
            <p style={{ color:'#CBD5E1', fontSize:11, margin:'1px 0' }}>
              {profile?.comorbid_hypertension ? 'Hypertension' : '—'}
            </p>
          </div>

          <div style={{ marginBottom:10 }}>
            <p style={{ color:'#22D3EE', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>Medications</p>
            <p style={{ color:'#CBD5E1', fontSize:11, margin:'1px 0' }}>{profile?.medication ?? '—'} (prescribed)</p>
          </div>

          <div style={{ marginBottom:10 }}>
            <p style={{ color:'#22D3EE', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>Recent Labs</p>
            {[
              ['HbA1c', `${profile?.hba1c_pct?.toFixed(1)}%`, (profile?.hba1c_pct ?? 0) > 7],
              ['FBS',   `${fmt.glucose(currentGlucose)} mg/dL`, currentGlucose > 126],
              ['BP',    `${profile?.sbp_mmhg}/${profile?.dbp_mmhg} mmHg`, (profile?.sbp_mmhg ?? 0) > 140],
            ].map(([k,v,high]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                <span style={{ color:'#64748B', fontSize:11 }}>{k}</span>
                <span style={{ color: high ? '#F87171' : '#94A3B8', fontSize:11, fontWeight:600 }}>
                  {v} {high ? '↑' : ''}
                </span>
              </div>
            ))}
          </div>

          <div>
            <p style={{ color:'#22D3EE', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>Genetic Markers</p>
            {[
              ['TCF7L2', (profile?.TCF7L2_risk ?? 0) === 1 ? 'Risk Allele' : 'Normal', (profile?.TCF7L2_risk ?? 0) === 1],
              ['KCNJ11', (profile?.KCNJ11_risk ?? 0) === 1 ? 'Risk Allele' : 'Normal', false],
              ['PPARG',  (profile?.PPARG_risk  ?? 0) === 1 ? 'Risk Allele' : 'Normal', false],
            ].map(([k,v,risk]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                <span style={{ color:'#64748B', fontSize:11 }}>{k}</span>
                <span style={{ color: risk ? '#F87171' : '#475569', fontSize:11, fontWeight: risk ? 700 : 400 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Real-time Wearable Feed */}
        <div className="card" style={{ padding:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <SectionHeader icon="⌚" title="Real-time Wearable Feed"/>
            <span style={{ color:'#475569', fontSize:9, fontWeight:600 }}>Simulated stream</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {[
              { label:'Heart Rate', icon:'❤️', value: lastStream?.heart_rate_bpm ? Math.round(lastStream.heart_rate_bpm) : '—', unit:'bpm',       data:hrArr,      color:'#F472B6' },
              { label:'Glucose',    icon:'🩸', value: fmt.glucose(currentGlucose),                                              unit:'mg/dL',     data:glucoseArr, color:'#F59E0B' },
              { label:'Steps',      icon:'👟', value: stepsArr.length ? stepsArr.reduce((a,b)=>a+b,0).toFixed(0) : '—',        unit:'today',     data:stepsArr,   color:'#34D399' },
              { label:'Sleep',      icon:'🌙', value: lastStream?.sleep_state != null ? `${(7+lastStream.sleep_state*0.4).toFixed(1)}h` : '—',   unit:'last night',data:sleepArr,   color:'#8B5CF6' },
            ].map(w => (
              <div key={w.label} style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, padding:'8px 10px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:4 }}>
                  <span style={{ fontSize:12 }}>{w.icon}</span>
                  <span style={{ color:'#64748B', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>{w.label}</span>
                </div>
                <p style={{ color:'white', fontSize:18, fontWeight:800, fontFamily:'monospace', margin:'0 0 2px', lineHeight:1 }}>
                  {w.value} <span style={{ fontSize:10, color:'#475569', fontWeight:400 }}>{w.unit}</span>
                </p>
                <Spark data={w.data} color={w.color} w={72} h={22}/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ COL 2: Digital Twin Body ══ */}
      <div style={{ display:'flex', flexDirection:'column', overflow:'auto' }}>
        <div className="card" style={{ padding:16, flex:1, display:'flex', flexDirection:'column' }}>
          <AnatomicalTwin
            band={band} prob={prob}
            currentGlucose={currentGlucose}
            metabolicState={metabolicState}
            factors={explainD?.factors ?? {}}
            patientInitials={patInitials}
            patientName={pid}
            patientAge={profile?.age}
            patientSex={profile?.sex}
            patientPhotoUrl={null}
          />

          {/* Predictive Analytics below body */}
          <div style={{ marginTop:12, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, padding:12 }}>
            <SectionHeader icon="🔮" title="Predictive Analytics Engine"/>
            <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:8, padding:10, marginBottom:8 }}>
              <p style={{ color:'#94A3B8', fontSize:10, margin:'0 0 2px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em' }}>Event Prediction</p>
              <p style={{ color:'#EF4444', fontSize:14, fontWeight:800, margin:'0 0 4px' }}>Glucose Spike</p>
              <p style={{ color:'#F87171', fontSize:11, margin:'0 0 6px' }}>
                {currentGlucose > 180 ? '(Currently above threshold)' : '(Predicted hyperglycemic episode)'}
              </p>
              <div style={{ display:'flex', gap:16 }}>
                <div>
                  <p style={{ color:'#64748B', fontSize:9, fontWeight:700, textTransform:'uppercase', margin:'0 0 1px' }}>Probability</p>
                  <p style={{ color:col, fontSize:22, fontWeight:900, fontFamily:'monospace', margin:0, lineHeight:1 }}>{fmt.prob(prob)}%</p>
                </div>
                <div>
                  <p style={{ color:'#64748B', fontSize:9, fontWeight:700, textTransform:'uppercase', margin:'0 0 1px' }}>Time to Event</p>
                  <p style={{ color:'#F59E0B', fontSize:14, fontWeight:800, margin:0 }}>
                    {predict?.horizon_hours ? `< ${predict.horizon_hours} hours` : '< 2 hours'}
                  </p>
                </div>
              </div>
            </div>

            <p style={{ color:'#94A3B8', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', margin:'0 0 6px' }}>Risk Factors</p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
              {(explainD?.factor_contributions ?? []).slice(0,4).map(f => (
                <div key={f.factor} style={{ background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:6, padding:'5px 8px', display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ color:'#F59E0B', fontSize:11 }}>⚠</span>
                  <div>
                    <p style={{ color:'#F59E0B', fontSize:9.5, fontWeight:700, margin:0 }}>{f.label}</p>
                    <p style={{ color:'#475569', fontSize:9, margin:0 }}>{f.pct.toFixed(0)}% contribution</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ══ COL 3: Alert Log + Wearable charts ══ */}
      <div style={{ display:'flex', flexDirection:'column', gap:10, overflow:'auto' }}>

        {/* Alert Log */}
        <div className="card" style={{ padding:14 }}>
          <SectionHeader icon="🔔" title="Alert Log"/>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {alerts.slice(0,3).map((a,i) => <AlertRow key={i} {...a}/>)}
          </div>
        </div>

        {/* Why this prediction — factor bars */}
        <div className="card" style={{ padding:14, flex:1 }}>
          <SectionHeader icon="📊" title="Why This Prediction?"/>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {(explainD?.factor_contributions ?? []).map(f => {
              const colors = ['#22D3EE','#F59E0B','#8B5CF6','#34D399','#F472B6','#60A5FA','#94A3B8']
              const c = colors[(f.rank-1) % colors.length]
              return (
                <div key={f.factor}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                    <span style={{ color:'#94A3B8', fontSize:10 }}>{f.rank}. {f.label}</span>
                    <span style={{ color:'white', fontSize:10, fontWeight:700, fontFamily:'monospace' }}>{f.pct.toFixed(1)}%</span>
                  </div>
                  <div style={{ height:5, background:'rgba(255,255,255,0.07)', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${f.pct}%`, background:`linear-gradient(90deg,${c}aa,${c})`, borderRadius:3, transition:'width .6s ease' }}/>
                  </div>
                </div>
              )
            })}
          </div>
          <p style={{ color:'#1e3a5f', fontSize:9, marginTop:8, marginBottom:0 }}>Contributions sum to 100%</p>
        </div>

        {/* Risk factor chips */}
        <div className="card" style={{ padding:14 }}>
          <SectionHeader icon="⚠" title="Risk Factors"/>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {/* Risk chips driven by real data */}
            {(explainD?.factor_contributions ?? []).slice(0, 4).map(f => {
              const ICONS = {
                meal_and_carbs:'🍞', activity:'🏃', hr_and_hrv:'💓',
                sleep:'🌙', recent_glucose_trend:'📈', medication:'💊', ehr_context:'📋',
              }
              const isHigh = f.pct > 20
              return (
                <RiskFactorChip
                  key={f.factor}
                  icon={ICONS[f.factor] ?? '⚠'}
                  label={f.label}
                  sublabel={`${f.pct.toFixed(0)}% of prediction`}
                  color={isHigh ? '#EF4444' : f.pct > 12 ? '#F59E0B' : '#22D3EE'}
                />
              )
            })}
            {/* Fallback if no factors yet */}
            {(explainD?.factor_contributions ?? []).length === 0 && (
              <>
                <RiskFactorChip icon="📈" label="Loading…" sublabel="Fetching model data" color="#475569"/>
                <RiskFactorChip icon="📈" label="Loading…" sublabel="Fetching model data" color="#475569"/>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ══ COL 4: Clinician Panel + Quick Summary + Status ══ */}
      <div style={{ display:'flex', flexDirection:'column', gap:10, overflow:'auto' }}>

        {/* Clinician Interaction Panel */}
        <div className="card" style={{ padding:14 }}>
          <SectionHeader icon="⚡" title="Clinician Interaction Panel"/>
          <p style={{ color:'#475569', fontSize:10, marginBottom:10, marginTop:0 }}>What-If Simulator — adjust lifestyle &amp; treatment parameters</p>

          {/* Sliders */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {[
              { label:'Daily Carbs (g)',                   value:carbs,   min:60,   max:300,   set:setCarbs   },
              { label:'Physical Activity (steps/day)',     value:steps,   min:2000, max:15000, set:setSteps   },
              { label:'Metformin Dose (mg/day)',           value:metDose, min:500,  max:2000,  set:setMetDose },
            ].map(s => (
              <div key={s.label}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ color:'#94A3B8', fontSize:10 }}>{s.label}</span>
                  <span style={{ color:'white', fontSize:10, fontWeight:700, fontFamily:'monospace' }}>{s.value.toLocaleString()}</span>
                </div>
                <input type="range" min={s.min} max={s.max} value={s.value}
                  className="slider-track" style={{ width:'100%' }}
                  onChange={e => s.set(+e.target.value)}/>
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:1 }}>
                  <span style={{ color:'#334155', fontSize:9 }}>{s.min.toLocaleString()}</span>
                  <span style={{ color:'#334155', fontSize:9 }}>{s.max.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>

          <button className="btn-cyan" style={{ marginTop:12 }} onClick={runSim} disabled={simLoading}>
            {simLoading ? 'Running…' : '▶ Run Simulation'}
          </button>

          {/* Simulation Results */}
          {simResult && (
            <div style={{ marginTop:10, background:'rgba(52,211,153,0.08)', border:'1px solid rgba(52,211,153,0.2)', borderRadius:8, padding:10 }}>
              <p style={{ color:'#34D399', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', margin:'0 0 6px' }}>Simulation Results</p>
              <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                <div>
                  <p style={{ color:'#475569', fontSize:9, margin:'0 0 1px' }}>Predicted 24h Risk</p>
                  <p style={{ color:riskColor(simResult.intervention_risk_band), fontSize:20, fontWeight:900, fontFamily:'monospace', margin:0 }}>
                    {fmt.prob(simResult.intervention_prob)}%
                  </p>
                </div>
                <div style={{ fontSize:22, color: simResult.diff_percentage_points < 0 ? '#34D399' : '#EF4444' }}>
                  {simResult.diff_percentage_points < 0 ? '↓' : '↑'}
                </div>
                <div>
                  <p style={{ color:'#475569', fontSize:9, margin:'0 0 1px' }}>Change</p>
                  <p style={{ color: simResult.diff_percentage_points < 0 ? '#34D399' : '#EF4444', fontSize:16, fontWeight:800, fontFamily:'monospace', margin:0 }}>
                    {simResult.diff_percentage_points > 0 ? '+' : ''}{simResult.diff_percentage_points.toFixed(1)} pp
                  </p>
                </div>
              </div>
              <p style={{ color:'#1e3a5f', fontSize:9, marginTop:6, marginBottom:0 }}>model simulation, not causal or clinical advice</p>
            </div>
          )}

          {/* Key Insights */}
          <div style={{ marginTop:10 }}>
            <p style={{ color:'#475569', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>Key Insights</p>
            {[
              `Lower post-meal glucose spikes (target < 180 mg/dL)`,
              `Improved glucose variability (current std: ${explainD?.window_glucose_stats?.glucose_std?.toFixed(0) ?? '—'} mg/dL)`,
              `Better sleep quality (factor: ${explainD?.factors?.sleep?.toFixed(0) ?? '—'}%)`,
              `Reduced cardiovascular risk (HR/HRV factor: ${explainD?.factors?.hr_and_hrv?.toFixed(0) ?? '—'}%)`,
            ].map((ins,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                <span style={{ color:'#34D399', fontSize:11 }}>✓</span>
                <span style={{ color:'#CBD5E1', fontSize:11 }}>{ins}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recommended Interventions */}
        <div className="card" style={{ padding:14 }}>
          <SectionHeader icon="💡" title="Recommended Interventions"/>
          {[
            {
              n:1,
              text: profile?.medication
                ? `Continue ${profile.medication} ${metDose}mg/day`
                : `Medication as prescribed (${metDose}mg/day)`,
              sub:'(as tolerated)'
            },
            {
              n:2,
              text: `Reduce refined carbs to < ${Math.round(carbs * 0.75)}g/day`,
              sub:`(current target: ${carbs}g/day)`
            },
            {
              n:3,
              text:'Add 30 mins brisk walk daily',
              sub:`(target ${steps.toLocaleString()} steps/day)`
            },
          ].map(r => (
            <div key={r.n} style={{ display:'flex', gap:10, marginBottom:8, alignItems:'flex-start' }}>
              <span style={{ width:20, height:20, borderRadius:'50%', background:'rgba(34,211,238,0.15)', border:'1px solid rgba(34,211,238,0.35)', color:'#22D3EE', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{r.n}</span>
              <div>
                <p style={{ color:'white', fontSize:11, fontWeight:600, margin:'0 0 1px' }}>{r.text}</p>
                <p style={{ color:'#475569', fontSize:10, margin:0 }}>{r.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Summary */}
        <div className="card" style={{ padding:14 }}>
          <SectionHeader icon="📌" title="Quick Summary"/>
          {[
            ['Condition',        profile?.n_comorbidities > 0 ? `T2DM + ${profile.n_comorbidities} comorbidities` : 'Type 2 Diabetes'],
            ['Prediction',       `Glucose Spike (${predict?.horizon_hours ?? 2}h horizon)`],
            ['Risk Probability', `${fmt.prob(prob)}%`],
            ['Overall Risk',     band],
          ].map(([k,v]) => (
            <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:5, paddingBottom:5, borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color:'#475569', fontSize:11 }}>{k}</span>
              <span style={{ color: k === 'Overall Risk' ? riskColor(band) : 'white', fontSize:11, fontWeight:700 }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Patient Status */}
        <div className="card" style={{ padding:14 }}>
          <SectionHeader icon="❤" title="Patient Status"/>
          <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:8 }}>
            <HealthScore score={Math.max(1, Math.min(10, 10 - prob*5)).toFixed(1)} max={10}/>
            <div>
              <p style={{ color:'#475569', fontSize:10, margin:'0 0 2px' }}>Current Health Score</p>
              <p style={{ color:'#34D399', fontSize:12, fontWeight:700, margin:0 }}>
                {prob < 0.3 ? '↗ Improving' : prob < 0.6 ? '→ Stable' : '↘ At Risk'}
              </p>
              <p style={{ color:'#475569', fontSize:10, margin:'4px 0 0' }}>Trend</p>
            </div>
          </div>
          <Spark data={glucoseArr} color="#22D3EE" w="100%" h={36}/>
          <p style={{ color:'#475569', fontSize:9, marginTop:4, marginBottom:0 }}>Glucose trend (last 6h)</p>
        </div>

        {/* Bottom motivational */}
        <div className="card" style={{ padding:14, textAlign:'center', background:'linear-gradient(135deg,rgba(34,211,238,0.06),rgba(139,92,246,0.06))' }}>
          <p style={{ color:'white', fontSize:12, fontWeight:700, margin:'0 0 4px' }}>Small changes today.</p>
          <p style={{ color:'white', fontSize:12, fontWeight:700, margin:'0 0 8px' }}>A healthier tomorrow.</p>
          <p style={{ color:'#475569', fontSize:10, margin:0 }}>Your Digital Twin is here to help.</p>
        </div>
      </div>
    </div>
  )
}
