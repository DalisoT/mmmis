import { useEffect, useState } from 'react';

/**
 * Time-remaining countdown to a target timestamp.
 *
 * Returns the `msRemaining` rounded down to whole seconds. When the target
 * passes, returns 0 (negative values are clamped). Auto-cleans the interval
 * on unmount so you can just drop this into any component without thinking
 * about teardown.
 */
export function useCountdown(targetMs: number | null | undefined): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (targetMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [targetMs]);

  if (targetMs == null) return 0;
  return Math.max(0, Math.floor((targetMs - now) / 1000));
}

/** Formats a positive seconds value as `m:ss`. Negative / zero -> "0:00". */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
