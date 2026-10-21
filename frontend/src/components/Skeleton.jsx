export default function Skeleton({ className = '' }) {
  return (
    <div className={`animate-pulse bg-white/5 rounded-xl ${className}`} aria-hidden="true"/>
  );
}
export function SkeletonText({ lines = 3 }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({length:lines}).map((_,i)=>(
        <div key={i} className={`h-3 bg-white/5 rounded animate-pulse ${i===lines-1?'w-2/3':'w-full'}`}/>
      ))}
    </div>
  );
}
