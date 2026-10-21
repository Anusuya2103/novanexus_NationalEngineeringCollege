import { motion } from 'framer-motion';
import RiskBadge, { riskColor } from './RiskBadge.jsx';
import AboveThresholdBadge from './AboveThresholdBadge.jsx';
import CountUp from './CountUp.jsx';
import { fmt } from '../utils/fmt.js';

const EVENT_NAME = 'Glucose spike (>180 mg/dL within 2h)';

export default function PredictionCard({ predict, currentGlucose }) {
  if (!predict) return <div className="glass p-5 h-48 animate-pulse rounded-2xl" aria-busy="true"/>;

  const prob = predict.prob_mean ?? 0;
  const band = predict.risk_band ?? 'Low';
  const c    = riskColor(band);

  return (
    <motion.div initial={{opacity:0,scale:0.97}} animate={{opacity:1,scale:1}}
      className="glass p-5 text-center rounded-2xl" style={{borderColor: c+'40'}}
      role="region" aria-label="Prediction card">

      <p className="label mb-0.5">Event Predicted</p>
      <p className="text-xs text-slate-400 mb-3">{EVENT_NAME}</p>

      {/* Above-threshold badge */}
      {currentGlucose > 180 && (
        <div className="mb-3 flex justify-center">
          <AboveThresholdBadge glucose={currentGlucose}/>
        </div>
      )}

      {/* Big probability number */}
      <p className="font-bold tabular-nums leading-none mb-1 mono"
         style={{color: c, fontSize:'4.5rem'}} aria-live="polite"
         aria-label={`Risk probability: ${fmt.prob(prob)}%`}>
        <CountUp value={prob * 100} decimals={0} suffix="%"/>
      </p>

      <RiskBadge band={band} size="lg"/>

      <div className="flex justify-center gap-1.5 text-xs text-slate-500 mt-3">
        <span>90% interval:</span>
        <span className="tabular-nums mono text-slate-300">
          [{fmt.prob(predict.prob_lower)}%–{fmt.prob(predict.prob_upper)}%]
        </span>
      </div>
      <p className="text-xs text-slate-600 mt-1">Model band, not clinical probability</p>
    </motion.div>
  );
}
