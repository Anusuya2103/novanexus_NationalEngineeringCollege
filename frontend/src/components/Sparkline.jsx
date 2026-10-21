/**
 * Small inline SVG sparkline for wearable cards.
 */
export default function Sparkline({ data = [], color = '#22D3EE', height = 32, width = 80 }) {
  if (!data || data.length < 2) return <div style={{ width, height }} className="bg-white/5 rounded"/>

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = 2

  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - 2 * pad)
    const y = (height - pad) - ((v - min) / range) * (height - 2 * pad)
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sparkline-path"
        opacity="0.9"
      />
    </svg>
  )
}
