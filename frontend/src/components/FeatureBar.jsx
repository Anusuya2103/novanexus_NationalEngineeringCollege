/**
 * Horizontal importance bar for one feature.
 * value: 0–1 normalised importance score
 */
export default function FeatureBar({ name, value, max = 1, color = '#38bdf8' }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3 py-0.5">
      <span className="text-xs text-slate-400 w-44 truncate shrink-0" title={name}>{name}</span>
      <div className="flex-1 bg-slate-800 rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs text-slate-500 w-12 text-right tabular-nums">
        {value.toFixed(4)}
      </span>
    </div>
  )
}
