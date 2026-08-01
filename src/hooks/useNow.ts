import { useEffect, useState } from "react";

/**
 * The current time, re-read on an interval.
 *
 * Exists because `Date.now()` in a render body is impure — React may call a component more than once
 * for one screen, and two calls would disagree. It is also simply wrong for a value that has to keep
 * moving: without a tick, "2m ago" stays "2m ago" until something else happens to re-render.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
