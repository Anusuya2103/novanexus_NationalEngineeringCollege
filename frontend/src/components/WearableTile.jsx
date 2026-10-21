import Sparkline from './Sparkline.jsx';

export default function WearableTile({ label, value, unit, data=[], color='#22D3EE', trend, above, below }) {
  const arrow = trend > 0.5 ? '↑' : trend < -0.5 ? '↓' : '→';
  const arrowColor = trend > 0.5 ? '#EF4444' : trend < -0.5 ? '#34D399' : '#94A3B8';
  return (
    <div className="glass p-3 flex flex-col gap-1" role="region" aria-label={`${label}: ${value} ${unit}`}>
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {trend != null && <span className="text-xs font-bold" style={{color:arrowColor}} aria-label={`Trend: ${arrow}`}>{arrow}</span>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <span className="text-xl font-bold tabular-nums mono" style={{color}}>{value ?? '—'}</span>
          <span className="text-xs text-slate-500 ml-1">{unit}</span>
        </div>
        <Sparkline data={data} color={color} width={64} height={28}/>
      </div>
      {(above || below) && (
        <p className="text-xs text-amber-500">{above ? '▲ Above normal' : '▼ Below normal'}</p>
      )}
      <p className="text-xs text-slate-600">Simulated stream</p>
    </div>
  );
}
