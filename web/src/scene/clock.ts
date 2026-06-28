/**
 * SPEC-301 §2.7 (F1) — ONE shared requestAnimationFrame loop.
 *
 * Every sprite's frame advance + roaming interpolation derives from this single clock.
 * There are ZERO per-sprite setInterval/RAF timers (AC-13a): sprites `subscribe` a
 * callback and the singleton drives them all from one loop. `frameAt` computes the
 * state-entry-anchored frame index (AC-13b) and is pure for testability.
 */

export type ClockListener = (t: number) => void;

const listeners = new Set<ClockListener>();
let rafId: number | null = null;
let lastT = 0;

// Indirection so tests can assert a single RAF loop / drive it deterministically.
let raf: (cb: (t: number) => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(() => cb(now()), 16) as unknown as number;
let caf: (id: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (id) => cancelAnimationFrame(id)
    : (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function loop(t: number): void {
  lastT = t;
  for (const l of listeners) l(t);
  rafId = raf(loop);
}

function ensureRunning(): void {
  if (rafId === null && listeners.size > 0) {
    rafId = raf(loop);
  }
}

function stop(): void {
  if (rafId !== null) {
    caf(rafId);
    rafId = null;
  }
}

/** Subscribe a per-frame callback to the single shared loop. Returns an unsubscribe fn. */
export function subscribe(listener: ClockListener): () => void {
  listeners.add(listener);
  ensureRunning();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** Current shared time (ms). Stable within a frame. */
export function getTime(): number {
  return lastT || now();
}

export function listenerCount(): number {
  return listeners.size;
}

export function isRunning(): boolean {
  return rafId !== null;
}

/**
 * SPEC-301 §2.7 / AC-13b — state-entry-anchored frame index:
 *   frame = floor((t − tEnter) * fps) mod frames
 * `tEnter` is the shared-clock time the sprite entered its current animation state, so a
 * state transition (tEnter reset) starts at frame 0 and a held state preserves phase.
 */
export function frameAt(t: number, tEnter: number, fps: number, frames: number): number {
  if (frames <= 1 || fps <= 0) return 0;
  const elapsed = Math.max(0, t - tEnter);
  return Math.floor((elapsed * fps) / 1000) % frames;
}

/** Test-only: inject a deterministic RAF driver and reset state. */
export function __setClockDriverForTest(opts: {
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
}): void {
  stop();
  listeners.clear();
  lastT = 0;
  if (opts.raf) raf = opts.raf;
  if (opts.caf) caf = opts.caf;
}
