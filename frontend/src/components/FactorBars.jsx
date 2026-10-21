/** Full ranked factor-contribution bars with hover explanations */
import { motion } from 'framer-motion';

const COLORS = {
  recent_glucose_trend:'#22D3EE', meal_and_carbs:'#F59E0B',
  sleep:'#8B5CF6', activity:'#34D399', hr_and_hrv:'#F472B6',
  medication:'#60A5FA', ehr_context:'#94A3B8',
};
const EXPLANATIONS = {
  recent_glucose_trend:'How fast glucose has been rising and how high it is now.',
  meal_and_carbs:'Carbohydrate intake and time since the last meal.',
  sleep:'Sleep duration and quality in the past window.',
  activity:'Step count and movement level.',
  hr_and_hrv:'Heart rate elevation and reduced HRV indicate metabolic stress.',
  medication:'Whether medication was taken and which type.',
  ehr_context:'Static patient factors: HbA1c, BMI, age, comorbidities.',
};

export default function FactorBars({ factors = [], title = 'Why this prediction?' }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-slate-600">Sum: 100%</p>
      </div>
      <div className="space-y-1.5" role="list" aria-label="Factor contributions">
        {factors.map((f, i) => (
          <motion.div key={f.factor}
            initial={{opacity:0,x:-12}} animate={{opacity:1,x:0}}
            transition={{delay:i*0.05,duration:0.35}}
            className="group relative" role="listitem">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 w-4 text-right">{f.rank}</span>
              <span className="text-xs text-slate-300 w-36 truncate" title={f.label}>{f.label}</span>
              <div className="flex-1 bg-white/5 rounded-full h-2" role="progressbar"
                   aria-valuenow={f.pct} aria-valuemin={0} aria-valuemax={100}
                   aria-label={`${f.label}: ${f.pct.toFixed(1)}%`}>
                <motion.div className="h-2 rounded-full"
                  initial={{width:0}} animate={{width:`${Math.min(100,f.pct)}%`}}
                  transition={{delay:i*0.05+0.1,duration:0.6,ease:'easeOut'}}
                  style={{background:`linear-gradient(90deg,${COLORS[f.factor]||'#94A3B8'}aa,${COLORS[f.factor]||'#94A3B8'})`}}/>
              </div>
              <span className="text-xs font-semibold tabular-nums mono text-slate-300 w-10 text-right">
                {f.pct.toFixed(1)}%
              </span>
            </div>
            {/* Hover tooltip */}
            <div className="absolute left-12 top-6 z-20 hidden group-hover:block glass p-2 text-xs text-slate-300 max-w-48 rounded-lg shadow-xl pointer-events-none"
                 role="tooltip">
              {EXPLANATIONS[f.factor] || ''}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
