import { riskColor } from '../utils/fmt.js';

const CONFIGS = {
  Low:        { cls: 'badge-low',       icon: '●' },
  Moderate:   { cls: 'badge-moderate',  icon: '▲' },
  High:       { cls: 'badge-high',      icon: '▲' },
  'Very High':{ cls: 'badge-very-high', icon: '⬆' },
};

export default function RiskBadge({ band, size = 'sm' }) {
  if (!band) return null;
  const cfg = CONFIGS[band] || CONFIGS.Moderate;
  const sz  = size === 'lg' ? 'text-sm px-3 py-1' : 'text-xs px-2 py-0.5';
  return (
    <span className={`${cfg.cls} ${sz} inline-flex items-center gap-1.5 rounded-full font-semibold border`}
          aria-label={`Risk level: ${band}`}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:riskColor(band)}}/>
      {band}
    </span>
  );
}

export { riskColor };
