/**
 * Stylized translucent body SVG with organ markers.
 * Tinted by risk level. Shows: Heart, Pancreas, Liver, Brain.
 * "model-derived indicators" labels per spec.
 */
import { riskColor } from './RiskBadge.jsx'

const ORGANS = [
  { id: 'brain',    label: 'Brain',    cx: 100, cy: 48,  r: 14 },
  { id: 'heart',    label: 'Heart',    cx: 88,  cy: 102, r: 10 },
  { id: 'liver',    label: 'Liver',    cx: 112, cy: 115, r: 12 },
  { id: 'pancreas', label: 'Pancreas', cx: 100, cy: 132, r: 9  },
]

export default function BodySVG({ band = 'Low', prob = 0 }) {
  const color   = riskColor(band)
  const opacity = 0.15 + prob * 0.35

  return (
    <div className="flex flex-col items-center select-none">
      <svg viewBox="0 20 200 280" width="160" height="220" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="bodyGlow" cx="50%" cy="40%" r="60%">
            <stop offset="0%"   stopColor={color} stopOpacity={opacity * 0.6}/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* Body silhouette */}
        <ellipse cx="100" cy="55" rx="22" ry="26" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5"/>
        <path d="M78,78 Q60,90 58,130 Q56,170 62,200 L74,200 L78,160 L82,200 L94,200 L96,150 L100,80 L104,150 L106,200 L118,200 L122,160 L126,200 L138,200 Q144,170 142,130 Q140,90 122,78 Z"
              fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5"/>
        {/* Arms */}
        <path d="M78,85 Q50,100 44,140" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5"/>
        <path d="M122,85 Q150,100 156,140" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5"/>

        {/* Glow overlay */}
        <ellipse cx="100" cy="120" rx="40" ry="70" fill="url(#bodyGlow)" className="pulse-glow"/>

        {/* Organ markers */}
        {ORGANS.map(o => (
          <g key={o.id} filter="url(#glow)">
            <circle cx={o.cx} cy={o.cy} r={o.r}
                    fill={color} fillOpacity={0.18}
                    stroke={color} strokeOpacity={0.7} strokeWidth="1.2"/>
            <circle cx={o.cx} cy={o.cy} r="3" fill={color} fillOpacity={0.9}/>
            <text x={o.cx + o.r + 4} y={o.cy + 4} fontSize="8"
                  fill="rgba(255,255,255,0.55)" fontFamily="Inter, sans-serif">
              {o.label}
            </text>
          </g>
        ))}

        {/* Connection lines to organs */}
        {ORGANS.map((o, i) => (
          <line key={`l${i}`}
            x1="100" y1="120" x2={o.cx} y2={o.cy}
            stroke={color} strokeOpacity="0.2" strokeWidth="0.8"
            strokeDasharray="3 3"/>
        ))}
      </svg>
      <p className="text-xs text-slate-600 text-center mt-1 leading-tight">
        model-derived indicators<br/>
        <span className="text-slate-700">not anatomical</span>
      </p>
    </div>
  )
}
