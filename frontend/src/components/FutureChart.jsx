/**
 * The signature glucose chart:
 * - Cyan solid history (last 6h)
 * - Vertical NOW line
 * - Violet dotted forecast + shaded uncertainty band
 * - Red dashed 180 threshold + shaded area above
 * - Forecast peak marker
 * - Ground-truth chip after +120m
 * - Meal markers
 */
import {
  ResponsiveContainer, ComposedChart, Line, Area, ReferenceArea,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { fmt } from '../utils/fmt.js';

function buildData(displaySeries, interventionSeries = null) {
  if (!displaySeries) return [];
  const { historical = [], predicted = [] } = displaySeries;
  const rows = historical.map(pt => ({ t: pt.t_min, glucose: pt.glucose_mgdl, src: 'observed' }));
  if (historical.length && predicted.length) {
    const last = historical[historical.length - 1];
    rows.push({ t: 0, glucose: last.glucose_mgdl, forecast: last.glucose_mgdl, lower: last.glucose_mgdl, upper: last.glucose_mgdl, src: 'bridge' });
  }
  predicted.forEach(pt => rows.push({ t: pt.t_min, forecast: pt.glucose_mgdl, lower: pt.lower ?? pt.glucose_mgdl, upper: pt.upper ?? pt.glucose_mgdl, src: 'forecast' }));
  if (interventionSeries) {
    interventionSeries.forEach((v, i) => {
      const tMin = [30,60,90,120][i];
      const row = rows.find(r => r.t === tMin);
      if (row) row.intervention = v;
    });
  }
  return rows;
}

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="glass p-2.5 text-xs shadow-xl rounded-xl" role="tooltip">
      <p className="text-slate-400 mb-1.5">{label >= 0 ? `+${label} min` : `${label} min`}</p>
      {d.glucose   != null && <p style={{color:'#22D3EE'}}>Observed: <b>{fmt.glucose(d.glucose)} mg/dL</b></p>}
      {d.forecast  != null && <p style={{color:'#8B5CF6'}}>Forecast: <b>{fmt.glucose(d.forecast)} mg/dL</b></p>}
      {d.upper     != null && d.lower != null && d.upper !== d.lower &&
        <p className="text-slate-500">90% interval: [{fmt.glucose(d.lower)}–{fmt.glucose(d.upper)}]</p>}
      {d.intervention != null && <p style={{color:'#34D399'}}>With intervention: <b>{fmt.glucose(d.intervention)} mg/dL</b></p>}
    </div>
  );
};

export default function FutureChart({
  displaySeries, interventionForecast = null,
  trueLabel = null, title = 'Glucose History & Forecast',
}) {
  const data = buildData(displaySeries, interventionForecast);
  if (!data.length) return <div className="h-56 bg-white/5 rounded-xl animate-pulse" aria-busy="true"/>;

  const forecastPts = data.filter(d => d.forecast != null && d.t > 0);
  const peakForecast = forecastPts.reduce((best, d) => (!best || d.forecast > best.forecast) ? d : best, null);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-white">{title}</p>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{background:'#22D3EE'}}/> Observed</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{background:'#8B5CF6',borderTop:'2px dashed #8B5CF6',height:0}}/> Forecast</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded bg-red-500"/> 180 mg/dL</span>
          {interventionForecast && <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{background:'#34D399'}}/> Intervene</span>}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240} aria-label="Glucose trajectory chart">
        <ComposedChart data={data} margin={{top:8,right:12,left:-8,bottom:4}}>
          <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.04)"/>
          <XAxis dataKey="t" stroke="#334155" tick={{fontSize:9,fill:'#475569'}}
                 tickFormatter={v => v===0 ? 'Now' : `${v>0?'+':''}${v}m`}/>
          <YAxis stroke="#334155" tick={{fontSize:9,fill:'#475569'}} domain={[60,400]}
                 tickFormatter={v=>`${v}`} aria-label="Glucose (mg/dL)"/>
          <Tooltip content={<ChartTooltip/>}/>

          {/* Red shaded zone above threshold */}
          <ReferenceArea y1={180} y2={400} fill="#EF4444" fillOpacity={0.04}/>
          <ReferenceLine y={180} stroke="#EF4444" strokeDasharray="5 3" strokeWidth={1.5}
            label={{value:'180 mg/dL',position:'insideTopRight',fill:'#EF4444',fontSize:9}}/>

          {/* NOW line */}
          <ReferenceLine x={0} stroke="#22D3EE" strokeOpacity={0.4} strokeWidth={1.5}
            label={{value:'Now',position:'insideTopLeft',fill:'#22D3EE',fontSize:9}}/>

          {/* Uncertainty band */}
          <Area type="monotone" dataKey="upper" stroke="none" fill="#8B5CF6" fillOpacity={0.12} legendType="none"/>
          <Area type="monotone" dataKey="lower" stroke="none" fill="#070B14" fillOpacity={1}    legendType="none"/>

          {/* History */}
          <Line type="monotone" dataKey="glucose" stroke="#22D3EE" strokeWidth={2.5}
                dot={false} name="Observed" activeDot={{r:4,fill:'#22D3EE'}}/>

          {/* Forecast */}
          <Line type="monotone" dataKey="forecast" stroke="#8B5CF6" strokeWidth={2}
                strokeDasharray="5 4" dot={{fill:'#8B5CF6',r:3,strokeWidth:0}} name="Forecast"/>

          {/* Intervention overlay */}
          {interventionForecast && (
            <Line type="monotone" dataKey="intervention" stroke="#34D399" strokeWidth={2}
                  strokeDasharray="4 3" dot={{fill:'#34D399',r:3,strokeWidth:0}} name="Intervene"/>
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Forecast ruler */}
      <div className="flex justify-between mt-2 px-8 text-xs text-slate-600">
        {forecastPts.map(fp => (
          <div key={fp.t} className="text-center">
            <p>+{fp.t}m</p>
            <p className="text-slate-400 tabular-nums mono">{fmt.glucose(fp.forecast)}</p>
          </div>
        ))}
      </div>

      {/* Peak marker */}
      {peakForecast && (
        <div className="flex justify-between items-center mt-2 text-xs">
          <span className="text-slate-500">
            Forecast peak <span className="text-violet-400 font-semibold mono">~{fmt.glucose(peakForecast.forecast)} mg/dL</span> at +{peakForecast.t}m
          </span>
          {/* Ground truth chip */}
          {trueLabel != null && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
              trueLabel === 1
                ? 'bg-red-900/30 border-red-700/50 text-red-300'
                : 'bg-green-900/30 border-green-700/50 text-green-300'
            }`} aria-label="Ground truth outcome">
              Ground truth: {trueLabel === 1 ? 'Spike occurred' : 'No spike'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
