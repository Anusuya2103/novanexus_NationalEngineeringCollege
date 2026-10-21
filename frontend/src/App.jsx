import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { api, IS_MOCK } from './api.js'
import Dashboard       from './pages/Dashboard.jsx'
import FutureSimulator from './pages/FutureSimulator.jsx'
import ExplainabilityTab from './pages/ExplainabilityTab.jsx'
import PatientTimeline from './pages/PatientTimeline.jsx'
import ModelReport     from './pages/ModelReport.jsx'

const NAV = [
  { id:'/',            icon:'⊞', label:'Home' },
  { id:'/profile',     icon:'👤', label:'Patient Profile' },
  { id:'/twin',        icon:'◈',  label:'Digital Twin' },
  { id:'/predict',     icon:'📈', label:'Predictions' },
  { id:'/simulator',   icon:'⚡', label:'What-If Simulator' },
  { id:'/reports',     icon:'📄', label:'Reports' },
  { id:'/settings',    icon:'⚙',  label:'Settings' },
]

function Shell() {
  const [patients,   setPatients]   = useState([])
  const [pid,        setPid]        = useState('')
  const [apiOk,      setApiOk]      = useState(null)
  const [lastSync,   setLastSync]   = useState('')
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    api.health().then(d => setApiOk(d.status === 'ok')).catch(() => setApiOk(false))
    api.getPatients().then(d => {
      setPatients(d.patient_ids)
      setPid(d.patient_ids[0])
    }).catch(() => {})
  }, [])

  // Live sync timestamp
  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date()
      setLastSync(`${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')} AM`)
    }, 5000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', background:'var(--bg)' }}>

      {/* ── LEFT SIDEBAR ── */}
      <aside style={{
        width:'var(--sidebar-w)', flexShrink:0, background:'var(--bg2)',
        borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column',
        padding:'0 0 16px 0', zIndex:40,
      }}>
        {/* Logo */}
        <div style={{ padding:'18px 16px 14px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:'linear-gradient(135deg,#22D3EE,#8B5CF6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700, color:'white' }}>HT</div>
            <div>
              <p style={{ color:'white', fontWeight:700, fontSize:13, lineHeight:1.2, margin:0 }}>HealthTwin</p>
              <p style={{ color:'#475569', fontSize:10, lineHeight:1.3, margin:0 }}>Your Health, Simulated.</p>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ flex:1, padding:'12px 8px', display:'flex', flexDirection:'column', gap:2 }}>
          {NAV.map(n => (
            <div key={n.id}
              className={`nav-item ${location.pathname === n.id ? 'active' : ''}`}
              onClick={() => navigate(n.id)}>
              <span style={{ fontSize:15 }}>{n.icon}</span>
              {n.label}
            </div>
          ))}
        </nav>

        <div style={{ padding:'12px 16px', borderTop:'1px solid var(--border)' }}>
          <p style={{ color:'#1e3a5f', fontSize:11, lineHeight:1.6, fontWeight:600, margin:0 }}>Smarter Decisions.</p>
          <p style={{ color:'#1e3a5f', fontSize:11, lineHeight:1.6, fontWeight:600, margin:0 }}>Healthier Tomorrows.</p>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Top bar */}
        <header style={{
          height:'var(--topbar-h)', flexShrink:0,
          background:'var(--bg2)', borderBottom:'1px solid var(--border)',
          display:'flex', alignItems:'center', padding:'0 20px', gap:16, zIndex:30,
        }}>
          <div style={{ flex:1 }}>
            <h1 style={{ color:'white', fontWeight:700, fontSize:16, margin:0 }}>
              Digital Twin — Type 2 Diabetes Risk Prediction
            </h1>
            <p style={{ color:'#475569', fontSize:11, margin:0 }}>Personalized · Predictive · Preventive</p>
          </div>

          {/* Patient selector — from API */}
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:8, padding:'4px 10px' }}>
            <span style={{ color:'#64748B', fontSize:11 }}>Patient ID:</span>
            <select value={pid} onChange={e => setPid(e.target.value)}
              style={{ background:'transparent', border:'none', color:'white', fontSize:12, fontWeight:600, cursor:'pointer', outline:'none' }}>
              {patients.map(p => <option key={p} value={p} style={{ background:'#0B1120' }}>{p}</option>)}
            </select>
          </div>

          {/* Live sync — timestamp updates every 5s */}
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11 }}>
            <div className="pulse-dot" style={{ width:7, height:7, borderRadius:'50%', background: apiOk ? '#34D399' : '#EF4444' }}/>
            <div>
              <p style={{ color: apiOk ? '#34D399' : '#EF4444', fontWeight:600, margin:0 }}>
                {apiOk ? 'Live Data Sync' : 'API Offline'}
              </p>
              {lastSync && <p style={{ color:'#475569', margin:0 }}>Last updated: {lastSync}</p>}
            </div>
          </div>

          {/* Notification bell */}
          <div style={{ width:32, height:32, borderRadius:8, background:'var(--bg3)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#94A3B8', fontSize:16 }}>🔔</div>

          {/* Current patient quick pill — no hardcoded name */}
          {pid && (
            <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:8, padding:'4px 10px' }}>
              <div style={{ width:28, height:28, borderRadius:'50%', background:'linear-gradient(135deg,#22D3EE,#8B5CF6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'white' }}>
                {pid.replace(/\D/g,'').slice(0,2) || pid.slice(0,2).toUpperCase()}
              </div>
              <div>
                <p style={{ color:'white', fontWeight:600, fontSize:12, margin:0 }}>{pid}</p>
                <p style={{ color:'#475569', fontSize:10, margin:0 }}>Digital Twin Active</p>
              </div>
            </div>
          )}

          {IS_MOCK && (
            <span style={{ background:'rgba(245,158,11,.2)', border:'1px solid rgba(245,158,11,.5)', color:'#FCD34D', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4 }}>
              MOCK
            </span>
          )}
        </header>

        {apiOk === false && (
          <div style={{ background:'rgba(239,68,68,0.1)', borderBottom:'1px solid rgba(239,68,68,0.3)', color:'#F87171', fontSize:11, textAlign:'center', padding:'6px' }}>
            Cannot reach API at http://localhost:8000 — run <code style={{ fontFamily:'monospace' }}>make api</code> first
          </div>
        )}

        {/* ── Page content — each route is a SEPARATE page ── */}
        <main style={{ flex:1, overflow:'auto', padding:'16px' }}>
          {!pid ? (
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100%', color:'#475569' }}>
              Loading patients…
            </div>
          ) : (
            <Routes>
              {/* Home and Digital Twin → full dashboard */}
              <Route path="/"      element={<Dashboard pid={pid}/>}/>
              <Route path="/twin"  element={<Dashboard pid={pid}/>}/>

              {/* Patient Profile → timeline view */}
              <Route path="/profile" element={<PatientTimeline pid={pid}/>}/>

              {/* Predictions → explainability */}
              <Route path="/predict" element={<ExplainabilityTab pid={pid}/>}/>

              {/* What-If Simulator → future simulator */}
              <Route path="/simulator" element={<FutureSimulator pid={pid}/>}/>

              {/* Reports → model report */}
              <Route path="/reports" element={<ModelReport/>}/>

              {/* Settings → simple placeholder (not implemented) */}
              <Route path="/settings" element={
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'50vh', gap:12 }}>
                  <span style={{ fontSize:32 }}>⚙</span>
                  <p style={{ color:'#94A3B8', fontSize:14, margin:0 }}>Settings</p>
                  <p style={{ color:'#475569', fontSize:12 }}>Configuration options coming soon</p>
                </div>
              }/>
            </Routes>
          )}
        </main>

        <footer style={{ padding:'6px 20px', borderTop:'1px solid var(--border)', background:'var(--bg2)', textAlign:'center' }}>
          <p style={{ color:'#1e3a5f', fontSize:10, margin:0 }}>
            Simulated data · Model outputs are not clinical advice · Digital Twin Challenge 2026
          </p>
        </footer>
      </div>
    </div>
  )
}

export default function App() {
  return <BrowserRouter><Shell/></BrowserRouter>
}
