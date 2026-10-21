/**
 * Factor contribution bar — shows one of the 7 grouped factors.
 * pct: 0-100 percentage contribution.
 */
export default function FactorBar({ label, pct, rank, color = '#22D3EE', animate = true }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs text-slate-600 w-4 text-right shrink-0">{rank}</span>
      <span className="text-sm text-slate-300 w-40 shrink-0 truncate">{label}</span>
      <div className="flex-1 bg-white/5 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: `linear-gradient(90deg, ${color}cc, ${color})`,
            transition: animate ? 'width 0.8s cubic-bezier(0.4,0,0.2,1)' : 'none',
          }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums text-slate-300 w-12 text-right">
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}
