/**
 * Semicircular gauge showing hyperglycaemia probability.
 * prob: 0–1  |  lower/upper: 0–1 (MC dropout interval)
 */
export default function RiskGauge({ prob, lower, upper }) {
  if (prob == null) return null

  const pct    = Math.round(prob * 100)
  const loP    = Math.round((lower ?? prob) * 100)
  const hiP    = Math.round((upper ?? prob) * 100)
  const isHigh = prob >= 0.5

  // SVG arc helpers
  const R = 70
  const CX = 90
  const CY = 90
  const toRad = (deg) => (deg * Math.PI) / 180
  const arc = (angle) => {
    const rad = toRad(180 + angle)
    return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) }
  }
  const describeArc = (startDeg, endDeg, r = R) => {
    const s = toRad(180 + startDeg)
    const e = toRad(180 + endDeg)
    const x1 = CX + r * Math.cos(s)
    const y1 = CY + r * Math.sin(s)
    const x2 = CX + r * Math.cos(e)
    const y2 = CY + r * Math.sin(e)
    const large = endDeg - startDeg > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
  }

  const fillDeg  = prob  * 180
  const loDeg    = (lower ?? prob) * 180
  const hiDeg    = (upper ?? prob) * 180
  const fillColor = isHigh ? '#ef4444' : '#22c55e'

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 180 100" className="w-52 h-28">
        {/* Track */}
        <path d={describeArc(0, 180)} stroke="#1e293b" strokeWidth="14" fill="none" strokeLinecap="round"/>
        {/* Interval band */}
        <path d={describeArc(loDeg, hiDeg)} stroke={fillColor} strokeWidth="14" fill="none" opacity="0.25" strokeLinecap="round"/>
        {/* Fill */}
        <path d={describeArc(0, fillDeg)} stroke={fillColor} strokeWidth="14" fill="none" strokeLinecap="round"/>
        {/* Labels */}
        <text x="12"  y="98" className="text-[9px] fill-slate-500" fontSize="8">0%</text>
        <text x="162" y="98" className="text-[9px] fill-slate-500" fontSize="8" textAnchor="end">100%</text>
        <text x="90"  y="52" textAnchor="middle" fontSize="8" fill="#64748b">PROB</text>
        <text x="90"  y="72" textAnchor="middle" fontSize="22" fontWeight="700"
              fill={fillColor}>{pct}%</text>
        <text x="90"  y="86" textAnchor="middle" fontSize="8" fill="#64748b">
          [{loP}%–{hiP}%]
        </text>
      </svg>
      <span className={isHigh ? 'badge-risk-high' : 'badge-risk-low'}>
        {isHigh ? '⚠ HIGH RISK' : '✓ LOW RISK'}
      </span>
    </div>
  )
}
