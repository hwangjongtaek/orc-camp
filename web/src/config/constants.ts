/** Client-side mirrors of fixed backend caps (SPEC-006 / SPEC-101). */
export const PREVIEW_LINE_MAX = 12; // PREVIEW_LINES — backend redacted tail upper bound

// --- SPEC-203 terminal workspace (client hypotheses, §3.11) ------------------
/** Max entries in the terminal last-screen LRU cache (hypothesis, SPEC-203 §3.11 / §6 Q2). */
export const TERMINAL_LRU_MAX = 8;
/**
 * Latency banding for the status-bar freshness indicator (hypothesis, SPEC-203 §2.7 / §6 Q5).
 * Aligns with SPEC-103 PANE_VIEW_INTERVAL_MS (250–500ms): under `fresh` = live, over `stale` =
 * warn the stream may be lagging. Values are near-real-time honesty markers, not hard SLAs.
 */
export const TERMINAL_LATENCY_FRESH_MS = 1500;
export const TERMINAL_LATENCY_STALE_MS = 4000;
/**
 * Reduced-noise cooldown for the waiting-transition toast (SPEC-203 §2.9). An orc that flaps
 * active↔waiting between scans must not re-announce within this window; the first active→waiting
 * edge fires, later edges are suppressed until the cooldown lapses.
 */
export const WAITING_TOAST_COOLDOWN_MS = 45_000;
