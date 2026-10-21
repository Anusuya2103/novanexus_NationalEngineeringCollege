export default function ErrorCard({ message, onRetry }) {
  return (
    <div className="glass p-4 border border-red-800/40 bg-red-900/10 rounded-2xl">
      <p className="text-red-400 text-sm font-medium mb-2">Failed to load</p>
      <p className="text-slate-500 text-xs mb-3">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-xs">Retry</button>
      )}
    </div>
  );
}
