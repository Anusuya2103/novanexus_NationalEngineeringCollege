import { useState, useCallback } from 'react';
import { api } from '../api.js';

export function useWhatIf(pid) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const run = useCallback(async (interventions, nMc = 15) => {
    if (!pid) return;
    setLoading(true); setError(null);
    try { setData(await api.whatifById(pid, { interventions, n_mc: nMc })); }
    catch(e) { setError(e.message); }
    finally  { setLoading(false); }
  }, [pid]);

  return { data, loading, error, run };
}
