/**
 * SPEC-201 §3.8 (#45) — a tiny matchMedia hook for responsive (mobile) degrade.
 *
 * Returns whether `query` currently matches and re-renders on change. SSR/jsdom-safe: when
 * matchMedia is unavailable it reports `false` (desktop). No timers; it only subscribes to the
 * MediaQueryList change event.
 */
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const get = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;

  const [matches, setMatches] = useState<boolean>(get);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    onChange();
    // addEventListener is the modern API; addListener is the legacy fallback.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

/** SPEC-201 §3.8 — the dashboard's mobile breakpoint (matches the `.oc-detail` collapse). */
export const MOBILE_QUERY = '(max-width: 880px)';
