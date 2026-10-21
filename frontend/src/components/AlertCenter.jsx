/** Early Warning Center: alerts generated from model outputs */
import { motion } from 'framer-motion';

function buildAlerts(predict, explainData, profile) {
  const alerts = [];
  const prob  = predict?.prob_mean ?? 0;
  const band  = predict?.risk_band ?? 'Low';
  const stats = explainData?.window_glucose_stats ?? {};
  const slope = stats.glucose_slope_mgdl_per_15min ?? 0;
  const last  = stats.glucose_last ?? 0;

  if (last > 180)
    alerts.push({ level:'red',   title:'Currently above threshold',    why:`Current glucose ${Math.round(last)} mg/dL exceeds 180 mg/dL` });
  if (prob > 0.7)
    alerts.push({ level:'red',   title:'High spike probability',       why:`Model probability ${Math.round(prob*100)}% (${band} band, >70% threshold)` });
  else if (prob > 0.5)
    alerts.push({ level:'amber', title:'Moderate spike probability',   why:`Model probability ${Math.round(prob*100)}% (${band} band, >50%)` });
  if (slope > 2.5)
    alerts.push({ level:'amber', title:'Rapid glucose rise',           why:`+${slope.toFixed(1)} mg/dL / 15 min upward trend` });
  const sleepFactor = explainData?.factors?.sleep ?? 0;
  if (sleepFactor > 12)
    alerts.push({ level:'blue',  title:'Sleep quality contributing',   why:`Sleep factor contributes ${sleepFactor.toFixed(1)}% to prediction` });

  if (alerts.length === 0)
    alerts.push({ level:'green', title:'No active alerts', why:'All model outputs within normal ranges' });

  return alerts.slice(0, 4);
}

const LEVEL_STYLE = {
  red:   'bg-red-900/20 border-red-700/40 text-red-300',
  amber: 'bg-amber-900/20 border-amber-700/40 text-amber-300',
  blue:  'bg-blue-900/20 border-blue-700/40 text-blue-300',
  green: 'bg-emerald-900/20 border-emerald-700/40 text-emerald-300',
};
const LEVEL_DOT = { red:'#EF4444', amber:'#F59E0B', blue:'#60A5FA', green:'#34D399' };

export default function AlertCenter({ predict, explainData, profile }) {
  const alerts = buildAlerts(predict, explainData, profile);
  return (
    <div>
      <p className="text-sm font-semibold text-white mb-2">Early Warning Center</p>
      <div className="space-y-2" role="list" aria-label="Active alerts">
        {alerts.map((a, i) => (
          <motion.div key={i} initial={{opacity:0,y:4}} animate={{opacity:1,y:0}}
            transition={{delay:i*0.07}} role="listitem"
            className={`p-2.5 rounded-xl border text-xs ${LEVEL_STYLE[a.level]}`}>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{background:LEVEL_DOT[a.level]}}
                    aria-hidden="true"/>
              <span className="font-semibold">{a.title}</span>
            </div>
            <p className="pl-4 text-slate-400 text-xs">{a.why}</p>
          </motion.div>
        ))}
      </div>
      <p className="text-xs text-slate-600 mt-2">Alerts from model outputs only — not clinical decision rules</p>
    </div>
  );
}
