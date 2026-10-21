/** Shared formatting utilities — single source of truth for all displayed numbers */
export const fmt = {
  /** Glucose: integer mg/dL */
  glucose: (v) => v == null ? '—' : `${Math.round(v)}`,
  /** Probability: integer % */
  prob: (v) => v == null ? '—' : `${Math.round(v * 100)}`,
  /** Probability difference in percentage points */
  pp: (v) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)} pp`,
  /** Float to 4 decimal places */
  metric: (v) => v == null ? '—' : v.toFixed(4),
  /** Float to 1 decimal */
  dec1: (v) => v == null ? '—' : v.toFixed(1),
};

export function riskColor(band) {
  return { Low:'#34D399', Moderate:'#F59E0B', High:'#FB923C', 'Very High':'#EF4444' }[band] ?? '#94A3B8';
}

export function riskTextClass(band) {
  return { Low:'text-emerald-400', Moderate:'text-amber-400', High:'text-orange-400', 'Very High':'text-red-400' }[band] ?? 'text-slate-400';
}
