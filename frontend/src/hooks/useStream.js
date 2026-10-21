import { useState, useEffect, useRef } from 'react';
import { API_BASE, IS_MOCK } from '../api.js';

/**
 * Subscribe to SSE stream for a patient's wearable data.
 * Accumulates points; resets on pid change.
 * In mock mode, generates synthetic points locally.
 */
export function useStream(pid, active = true) {
  const [points, setPoints] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    if (!pid || !active) return;
    setPoints([]);

    if (IS_MOCK) {
      // Simulate stream locally
      let i = 0;
      const base = 160;
      const iv = setInterval(() => {
        setPoints(prev => [...prev.slice(-23), {
          step: i, t_min: (i - 23) * 15,
          glucose_mgdl: base + Math.sin(i / 3) * 30 + i * 0.5,
          heart_rate_bpm: 72 + Math.random() * 10,
          hrv_ms: 44 + Math.random() * 8,
          steps_5min: i > 8 && i < 12 ? 400 + Math.random()*100 : 20,
          sleep_state: i < 6 ? 2 : 0,
          carbs_15min: i === 4 ? 55 : 0,
          source: 'Simulated stream (mock)',
        }]);
        i++;
        if (i >= 24) clearInterval(iv);
      }, 800);
      return () => clearInterval(iv);
    }

    const url = `${API_BASE}/stream/${pid}?speed_ms=2000`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.event === 'stream_end') { es.close(); return; }
        setPoints(prev => [...prev.slice(-23), d]);
      } catch {}
    };
    es.onerror = () => { es.close(); };

    return () => { es.close(); };
  }, [pid, active]);

  return points;
}
