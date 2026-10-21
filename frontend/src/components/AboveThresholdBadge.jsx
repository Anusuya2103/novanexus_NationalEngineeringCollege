/** Shown when current glucose is already above 180 mg/dL */
export default function AboveThresholdBadge({ glucose }) {
  if (!glucose || glucose <= 180) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-xs font-semibold"
         role="alert" aria-live="assertive">
      <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse inline-block"/>
      Currently above threshold ({Math.round(glucose)} mg/dL &gt; 180)
    </div>
  );
}
