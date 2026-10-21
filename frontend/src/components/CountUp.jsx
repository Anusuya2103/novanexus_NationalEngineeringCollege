import { useEffect, useRef, useState } from 'react';

export default function CountUp({ value, duration = 800, decimals = 0, suffix = '' }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const fromRef  = useRef(0);

  useEffect(() => {
    const target = Number(value) || 0;
    const from   = fromRef.current;
    cancelAnimationFrame(rafRef.current);

    // Respect prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target); fromRef.current = target; return;
    }

    startRef.current = null;
    rafRef.current = requestAnimationFrame(function tick(ts) {
      if (!startRef.current) startRef.current = ts;
      const progress = Math.min((ts - startRef.current) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = from + (target - from) * ease;
      setDisplay(current);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else { setDisplay(target); fromRef.current = target; }
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <>{display.toFixed(decimals)}{suffix}</>;
}
