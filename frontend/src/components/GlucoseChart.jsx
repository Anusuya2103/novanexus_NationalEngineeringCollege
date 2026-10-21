/**
 * Glucose trajectory chart.
 * Renders historical window + forecast with uncertainty band.
 * All data comes from the /forecast API response.
 */
import {
  ResponsiveContainer, ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts'

const THRESHOLD = 180

function buildChartData(displaySeries) {
  if (!displaySeries) return []
  const { historical = [], predicted = [] } = displaySeries
  const data = historical.map(pt => ({
    t: pt.t_min,
    glucose: pt.glucose_mgdl,
    type: 'history',
  }))
  // Bridge: duplicate the last historical point as the first forecast point
  if (historical.length > 0 && predicted.length > 0) {
    const last = historical[historical.length - 1]
    data.push({
      t: 0,
      glucose: last.glucose_mgdl,
      forecast: last.glucose_mgdl,
      lower: last.glucose_mgdl,
      upper: last.glucose_mgdl,
      type: 'bridge',
    })
  }
  predicted.forEach(pt => {
    data.push({
      t: pt.t_min,
      forecast: pt.glucose_mgdl,
      lower: pt.lower,
      upper: pt.upper,
      type: 'forecast',
    })
  })
  return data
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{label >= 0 ? `+${label} min` : `${label} min`}</p>
      {d.glucose  != null && <p className="text-brand-400">History: <b>{d.glucose} mg/dL</b></p>}
      {d.forecast != null && <p className="text-amber-300">Forecast: <b>{d.forecast} mg/dL</b></p>}
      {d.lower    != null && <p className="text-slate-400">Interval: [{d.lower}–{d.upper}] mg/dL</p>}
    </div>
  )
}

export default function GlucoseChart({ displaySeries, title = 'Glucose Trajectory' }) {
  const data = buildChartData(displaySeries)
  if (!data.length) return (
    <div className="h-48 flex items-center justify-center text-slate-500 text-sm">No data</div>
  )

  return (
    <div className="w-full">
      <p className="label mb-3">{title}</p>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="t"
            stroke="#475569"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickFormatter={v => v === 0 ? 'Now' : `${v > 0 ? '+' : ''}${v}m`}
          />
          <YAxis
            stroke="#475569"
            tick={{ fontSize: 10, fill: '#64748b' }}
            domain={[55, 400]}
            tickFormatter={v => `${v}`}
            label={{ value: 'mg/dL', angle: -90, position: 'insideLeft', offset: 10, style: { fill: '#64748b', fontSize: 9 } }}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={THRESHOLD}
            stroke="#ef4444"
            strokeDasharray="6 3"
            label={{ value: '180 mg/dL threshold', position: 'insideTopRight', fill: '#ef4444', fontSize: 9 }}
          />
          {/* Forecast uncertainty band */}
          <Area
            type="monotone" dataKey="upper" data={data.filter(d => d.type === 'forecast' || d.type === 'bridge')}
            stroke="none" fill="#f59e0b" fillOpacity={0.12} legendType="none"
          />
          <Area
            type="monotone" dataKey="lower" data={data.filter(d => d.type === 'forecast' || d.type === 'bridge')}
            stroke="none" fill="#0f172a" fillOpacity={1} legendType="none"
          />
          {/* Historical line */}
          <Line
            type="monotone" dataKey="glucose"
            stroke="#38bdf8" strokeWidth={2} dot={false}
            name="History" legendType="line"
          />
          {/* Forecast line */}
          <Line
            type="monotone" dataKey="forecast"
            stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3"
            dot={{ fill: '#f59e0b', r: 4 }}
            name="Forecast" legendType="line"
          />
          <Legend
            wrapperStyle={{ fontSize: 10, color: '#94a3b8', paddingTop: 8 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
