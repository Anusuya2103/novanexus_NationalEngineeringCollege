import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from 'recharts'
import { api } from '../api.js'
import { fmt, riskColor } from '../utils/fmt.js'
import RiskBadge from '../components/RiskBadge.jsx'
import Spinner from '../components/Spinner.jsx'
import ErrorCard from '../components/ErrorCard.jsx'
import Skeleton from '../components/Skeleton.jsx'

const HORIZONS = [30, 60, 90, 120]
const EVENT_NAME = 'Glucose spike (>180 mg/dL within 2h)'

const SCENARIOS_DEF = {
  current:  { label:'Current Day',   color:'#94A3B8', interventions:{} },
  healthy:  { label:'Healthier Day', color:'#22D3EE', interventions:{ reduce_carbs_g:40, increase_steps:1500, sleep_quality:2, med_adherence:1.0 } },
  highrisk: { label:'High-Risk Day', color:'#EF4444', interventions:{ glucose_offset_mgdl:40, stress_level:0.8 } },
}

// NL query parser
function parseQuery(text) {
  const s = text.toLowerCase()
  const i = {}
  const walk  = s.match(/walk\w*\s+(\d+)\s*(min|minute)/i)
  if (walk)   i.increase_steps = parseInt(walk[1]) * 80
  const carbs = s.match(/(?:reduce|cut|fewer|less)\s+carbs?\s*(\d+)\s*g/i)
  if (carbs)  i.reduce_carbs_g = parseInt(carbs[1])
  const stress= s.match(/stress/i)
  if (stress) i.stress_level = 0.7
  const sleep = s.match(/sleep\s+(well|good|better|more)/i)
  if (sleep)  i.sleep_quality = 2
  const med   = s.match(/(take|took)\s*(meds?|medication|pill)/i)
  if (med)    i.add_medication = true
  return i
}

function buildChart(scenarios) {
  if (!scenarios.current) return []
  const baseGlucose = scenarios.current.last_glucose ?? 160
  const labels = ['Now', ...HORIZONS.map(h => `+${h}m`)]
  return labels.map((label, i) => {
    const row = { label }
    Object.entries(scenarios).forEach(([key, sc]) => {
      row[key] = i === 0 ? baseGlucose : (sc.forecast?.[i-1] ?? null)
    })
    return row
  })
}

export default function FutureSimulator({ pid }) {
  const [sliders, setSliders]     = useState({ reduce_carbs_g:0, increase_steps:0, sleep_quality:1, med_adherence:0.5, stress_level:0, glucose_offset_mgdl:0 })
  const [scenarios, setScenarios] = useState({})
  const [loading,   setLoading]   = useState({})
  const [nlQuery,   setNlQuery]   = useState('')
  const [nlResult,  setNlResult]  = useState(null)
  const [nlLoading, setNlLoading] = useState(false)
  const [nlError,   setNlError]   = useState(null)
  const debounceRef = useRef(null)
  const [sanity,    setSanity]    = useState(null)

  const runScenario = useCallback(async (key, interventions) => {
    setLoading(l => ({...l, [key]:true}))
    try {
      const wi = await api.whatifById(pid, { interventions, n_mc:10 })
      const win = await api.sampleWindow(pid)
      const fore = await api.forecast({ x_ts_flat: win.x_ts_flat, x_ehr: win.x_ehr, n_mc:5 })
      const lastG = fore.display_series?.historical?.at(-1)?.glucose_mgdl ?? 160
      const delta = wi.diff_percentage_points / 100
      setScenarios(s => ({
        ...s,
        [key]: {
          ...wi,
          last_glucose: lastG,
          forecast: fore.forecast.map((f, i) =>
            key === 'current' ? f.glucose_mgdl
            : Math.max(55, Math.min(400, (f.glucose_mgdl ?? 150) - delta * 15 * (i+1)))
          ),
          color: SCENARIOS_DEF[key]?.color ?? '#94A3B8',
          label: SCENARIOS_DEF[key]?.label ?? key,
        }
      }))
    } catch {}
    setLoading(l => ({...l, [key]:false}))
  }, [pid])

  useEffect(() => {
    runScenario('current',  SCENARIOS_DEF.current.interventions)
    runScenario('healthy',  SCENARIOS_DEF.healthy.interventions)
    runScenario('highrisk', SCENARIOS_DEF.highrisk.interventions)
    // Load sanity test results
    api.getMetrics().then(m => setSanity(m.sanity_tests)).catch(() => {})
  }, [runScenario])

  const runCustom = () => {
    const clean = Object.fromEntries(Object.entries(sliders).filter(([,v]) => v!==0 && v!==0.5))
    runScenario('custom', clean)
  }

  const runNl = async () => {
    const parsed = parseQuery(nlQuery)
    if (!Object.keys(parsed).length) {
      setNlError('Could not parse. Try: "walk 30 minutes", "reduce carbs 40g", "take medication".')
      return
    }
    setNlLoading(true); setNlError(null)
    try {
      const r = await api.whatifById(pid, { interventions: parsed, n_mc: 10 })
      setNlResult({ ...r, parsed })
    } catch(e) { setNlError(e.message) }
    setNlLoading(false)
  }

  const chartData = buildChart(scenarios)
  const anyLoading = Object.values(loading).some(Boolean)
  const sanityFailed = sanity && Object.values(sanity).some(t => !t.passed)

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* LEFT: controls */}
      <div className="col-span-4 flex flex-col gap-4">

        {/* Sanity warning */}
        {sanityFailed && (
          <div className="glass p-3 border border-amber-800/40 bg-amber-900/10 text-amber-300 text-xs rounded-2xl">
            <p className="font-semibold mb-1">Monotonicity check failed</p>
            <p className="text-amber-500">On this synthetic dataset, increasing activity or reducing carbs does not consistently reduce risk. Simulation outputs may not be intuitive. See Model Report for details.</p>
          </div>
        )}

        {/* Sliders */}
        <div className="glass p-4 rounded-2xl">
          <p className="text-sm font-semibold text-white mb-3">Custom Scenario</p>
          <div className="space-y-4">
            {[
              { key:'reduce_carbs_g',     label:'Reduce Carbs (g)',       min:0,   max:100, step:5 },
              { key:'increase_steps',     label:'Add Steps',              min:0,   max:3000,step:100 },
              { key:'sleep_quality',      label:'Sleep Quality (0–3)',    min:0,   max:3,   step:1 },
              { key:'med_adherence',      label:'Medication Adherence',   min:0,   max:1,   step:0.1 },
              { key:'stress_level',       label:'Stress Level (0–1)',     min:0,   max:1,   step:0.1 },
              { key:'glucose_offset_mgdl',label:'Glucose Offset (mg/dL)', min:-60, max:60,  step:5 },
            ].map(s => (
              <div key={s.key}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">{s.label}</span>
                  <span className="mono text-slate-200">{sliders[s.key]}</span>
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step}
                  className="w-full accent-cyan-500"
                  value={sliders[s.key]}
                  aria-label={s.label}
                  onChange={e => setSliders(v => ({...v, [s.key]:+e.target.value}))}/>
              </div>
            ))}
          </div>
          <button className="btn-primary w-full mt-4" onClick={runCustom}
                  disabled={anyLoading} aria-label="Run custom scenario">
            {loading.custom ? <Spinner size="sm"/> : 'Run Custom Scenario'}
          </button>
          <p className="text-xs text-amber-700 mt-2">model simulation, not causal or clinical advice</p>
        </div>

        {/* Preset scenarios */}
        <div className="glass p-4 rounded-2xl">
          <p className="text-sm font-semibold text-white mb-3">Preset Scenarios</p>
          <div className="space-y-2">
            {Object.entries(SCENARIOS_DEF).map(([key, sc]) => (
              <button key={key} className="btn-ghost w-full text-left"
                onClick={() => runScenario(key, sc.interventions)}
                disabled={loading[key]} aria-label={`Run ${sc.label} scenario`}>
                {loading[key] ? <Spinner size="sm"/> : <span className="w-2 h-2 rounded-full shrink-0" style={{background:sc.color}}/>}
                <span className="flex-1 text-sm">{sc.label}</span>
                <span className="mono text-xs text-slate-500">
                  {scenarios[key] ? `${fmt.prob(scenarios[key].intervention_prob)}%` : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Ask the Twin */}
        <div className="glass p-4 rounded-2xl">
          <p className="text-sm font-semibold text-white mb-1">Ask the Twin</p>
          <p className="text-xs text-slate-500 mb-2">Try: "what if he walks 30 minutes?" or "reduce carbs 40g"</p>
          <div className="flex gap-2">
            <input className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm
                              text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500
                              placeholder:text-slate-600"
              placeholder="Ask a what-if question…" value={nlQuery}
              onChange={e => setNlQuery(e.target.value)}
              onKeyDown={e => e.key==='Enter' && runNl()}
              aria-label="Ask the twin a what-if question"/>
            <button className="btn-primary px-3" onClick={runNl} disabled={nlLoading} aria-label="Submit question">
              {nlLoading ? <Spinner size="sm"/> : 'Ask'}
            </button>
          </div>
          {/* Chip suggestions */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {['walk 30 min','reduce carbs 40g','take medication','reduce stress'].map(chip => (
              <button key={chip} onClick={() => { setNlQuery(chip); }}
                className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-full text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors">
                {chip}
              </button>
            ))}
          </div>
          {nlError && <p className="text-red-400 text-xs mt-2">{nlError}</p>}
          {nlResult && (
            <motion.div initial={{opacity:0}} animate={{opacity:1}}
              className="mt-3 p-3 bg-white/5 rounded-xl text-xs space-y-1.5">
              <p className="font-semibold text-white">Simulation result</p>
              <p className="text-slate-400">Parsed: <span className="mono text-slate-300">{JSON.stringify(nlResult.parsed)}</span></p>
              <div className="flex items-center gap-3">
                <span>Before: <b className="mono text-slate-200">{fmt.prob(nlResult.baseline_prob)}%</b></span>
                <span className="text-slate-600">→</span>
                <span>After: <b className="mono" style={{color:riskColor(nlResult.intervention_risk_band)}}>{fmt.prob(nlResult.intervention_prob)}%</b></span>
              </div>
              <p className={`font-semibold mono ${nlResult.diff_percentage_points<0?'text-emerald-400':'text-red-400'}`}>
                {fmt.pp(nlResult.diff_percentage_points)}
              </p>
              <p className="text-amber-700">model simulation output</p>
            </motion.div>
          )}
        </div>
      </div>

      {/* RIGHT: chart + cards */}
      <div className="col-span-8 flex flex-col gap-4">
        <div className="glass p-4 rounded-2xl flex-1">
          <p className="text-sm font-semibold text-white mb-3">
            Glucose Trajectory — {Object.keys(scenarios).length} Scenarios
          </p>
          <p className="text-xs text-slate-500 mb-3">{EVENT_NAME} · Threshold: 180 mg/dL</p>
          {chartData.length === 0 ? <Skeleton className="h-64"/> : (
            <ResponsiveContainer width="100%" height={280} aria-label="Scenario trajectory chart">
              <LineChart data={chartData} margin={{top:4,right:16,left:-10,bottom:4}}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)"/>
                <XAxis dataKey="label" stroke="#334155" tick={{fontSize:10,fill:'#475569'}}/>
                <YAxis stroke="#334155" tick={{fontSize:10,fill:'#475569'}} domain={[55,400]}/>
                <Tooltip contentStyle={{background:'#0D1526',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,fontSize:11}}/>
                <ReferenceLine y={180} stroke="#EF4444" strokeDasharray="5 3" strokeWidth={1.5}
                  label={{value:'180 mg/dL',position:'insideTopRight',fill:'#EF4444',fontSize:9}}/>
                <Legend wrapperStyle={{fontSize:11,color:'#64748b',paddingTop:8}}/>
                {['current','healthy','highrisk','custom'].map(key => scenarios[key] && (
                  <Line key={key} type="monotone" dataKey={key}
                        stroke={scenarios[key].color} strokeWidth={2}
                        strokeDasharray={key==='highrisk'?'5 3':undefined}
                        dot={false} name={scenarios[key].label}/>
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Scenario result cards */}
        <div className="grid grid-cols-4 gap-3">
          {['current','healthy','highrisk','custom'].map(key => {
            const sc = scenarios[key]
            const cfg = SCENARIOS_DEF[key]
            return (
              <div key={key} className="glass p-4 rounded-2xl text-center"
                   style={{borderColor:(cfg?.color??'#334155')+'28'}}>
                <p className="label mb-2">{cfg?.label ?? 'Custom'}</p>
                {loading[key] ? <Skeleton className="h-8 mb-2"/> : (
                  <p className="text-2xl font-bold mono mb-1"
                     style={{color:cfg?.color??'#94A3B8'}}>
                    {sc ? `${fmt.prob(sc.intervention_prob)}%` : '—'}
                  </p>
                )}
                {sc && <RiskBadge band={sc.intervention_risk_band}/>}
                {sc && key!=='current' && (
                  <p className={`text-sm font-semibold mono mt-2 ${sc.diff_percentage_points<0?'text-emerald-400':'text-red-400'}`}>
                    {fmt.pp(sc.diff_percentage_points)}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
