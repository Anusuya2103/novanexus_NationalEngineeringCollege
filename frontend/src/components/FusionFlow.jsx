/** Animated SVG data fusion flow diagram */
export default function FusionFlow({ active = 'prediction' }) {
  const nodes = [
    { id:'ehr',        x:20,  y:30,  label:'EHR',        w:60, h:24 },
    { id:'wearables',  x:20,  y:70,  label:'Wearables',  w:60, h:24 },
    { id:'fusion',     x:110, y:50,  label:'Fusion',     w:60, h:24 },
    { id:'twin',       x:200, y:50,  label:'Twin State', w:70, h:24 },
    { id:'prediction', x:300, y:50,  label:'Prediction', w:70, h:24 },
  ];
  const edges = [
    { from:[80,42],  to:[110,57] },
    { from:[80,82],  to:[110,67] },
    { from:[170,62], to:[200,62] },
    { from:[270,62], to:[300,62] },
  ];
  return (
    <svg viewBox="0 0 400 110" className="w-full" aria-label="Data fusion pipeline diagram">
      <defs>
        <filter id="nodeGlow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      {edges.map((e,i) => (
        <line key={i} x1={e.from[0]} y1={e.from[1]} x2={e.to[0]} y2={e.to[1]}
          stroke="#22D3EE" strokeWidth="1.5" strokeOpacity="0.35"
          strokeDasharray="4 3" className="flow-line"/>
      ))}
      {nodes.map(n => {
        const isActive = n.id === active;
        return (
          <g key={n.id} filter={isActive ? 'url(#nodeGlow)' : undefined}>
            <rect x={n.x} y={n.y - 12} width={n.w} height={n.h} rx="6"
              fill={isActive ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.04)'}
              stroke={isActive ? '#22D3EE' : 'rgba(255,255,255,0.08)'} strokeWidth="1"/>
            <text x={n.x + n.w/2} y={n.y + 4} textAnchor="middle" fontSize="9"
              fill={isActive ? '#22D3EE' : '#64748b'} fontFamily="Inter,sans-serif">
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
