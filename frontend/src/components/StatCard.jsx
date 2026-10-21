/** Simple metric card: label + big value + optional sub-label */
export default function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="card flex flex-col gap-1">
      <span className="label">{label}</span>
      <span className={`value-lg ${color}`}>{value ?? '—'}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  )
}
