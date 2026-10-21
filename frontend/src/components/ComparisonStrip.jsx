/** Bottom "Today vs If We Intervene" strip */
import { motion } from 'framer-motion';
import RiskBadge, { riskColor } from './RiskBadge.jsx';
import CountUp from './CountUp.jsx';
import { fmt } from '../utils/fmt.js';

function MiniBody({ band }) {
  const c = riskColor(band);
  return (
    <svg viewBox="0 20 200 200" width="80" height="100" aria-hidden="true">
      <ellipse cx="100" cy="55" rx="20" ry="22" fill="none" stroke={c} strokeOpacity="0.5" strokeWidth="1.5"/>
      <path d="M82,75 Q66,88 64,120 L70,120 L76,95 L80,120 L92,120 L96,80 L100,78 L104,80 L108,120 L120,120 L124,95 L130,120 L136,120 Q134,88 118,75 Z"
            fill={c} fillOpacity="0.12" stroke={c} strokeOpacity="0.3" strokeWidth="1"/>
      <circle cx="100" cy="90" r="6" fill={c} fillOpacity="0.6"/>
    </svg>
  );
}

export default function ComparisonStrip({ wiData, interventionLabel = 'Reduce carbs 30g + 500 steps' }) {
  if (!wiData) return null;
  const diff = wiData.diff_percentage_points ?? 0;
  const isImprovement = diff < 0;

  return (
    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:0.4}}
      className="glass p-4 rounded-2xl" aria-label="Today vs intervention comparison">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Patient Today vs If We Intervene
        </p>
        <p className="text-xs text-amber-700">model simulation, not causal or clinical advice</p>
      </div>

      <div className="flex items-center gap-4">
        {/* Today */}
        <div className="flex flex-col items-center gap-1 min-w-[80px]">
          <MiniBody band={wiData.baseline_risk_band}/>
          <p className="text-xl font-bold tabular-nums mono" style={{color:riskColor(wiData.baseline_risk_band)}}>
            {fmt.prob(wiData.baseline_prob)}%
          </p>
          <RiskBadge band={wiData.baseline_risk_band}/>
          <p className="text-xs text-slate-500">Today</p>
        </div>

        {/* Arrow + delta */}
        <div className="flex-1 flex flex-col items-center gap-1">
          <p className="text-xs text-slate-500 text-center">{interventionLabel}</p>
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 h-0.5 bg-white/10 rounded"/>
            <motion.p
              key={diff}
              initial={{scale:0.8,opacity:0}} animate={{scale:1,opacity:1}}
              transition={{type:'spring',stiffness:300}}
              className={`text-2xl font-bold tabular-nums mono ${isImprovement?'text-emerald-400':'text-red-400'}`}
              aria-live="polite" aria-label={`Change: ${fmt.pp(diff)}`}>
              <CountUp value={diff} decimals={1} suffix=" pp"/>
            </motion.p>
            <div className="flex-1 h-0.5 bg-white/10 rounded"/>
          </div>
          <p className="text-xs text-slate-600">percentage points</p>
        </div>

        {/* Intervention */}
        <div className="flex flex-col items-center gap-1 min-w-[80px]">
          <MiniBody band={wiData.intervention_risk_band}/>
          <p className="text-xl font-bold tabular-nums mono" style={{color:riskColor(wiData.intervention_risk_band)}}>
            {fmt.prob(wiData.intervention_prob)}%
          </p>
          <RiskBadge band={wiData.intervention_risk_band}/>
          <p className="text-xs text-slate-500">With intervention</p>
        </div>
      </div>
    </motion.div>
  );
}
