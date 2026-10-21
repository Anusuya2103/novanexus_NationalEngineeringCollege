import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

export function usePredict(pid, windowIdx) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const run = useCallback(async () => {
    if (!pid) return;
    setLoading(true); setError(null);
    try { setData(await api.predictById(pid, windowIdx)); }
    catch(e) { setError(e.message); }
    finally  { setLoading(false); }
  }, [pid, windowIdx]);

  useEffect(() => { run(); }, [run]);
  return { data, loading, error, refetch: run };
}
