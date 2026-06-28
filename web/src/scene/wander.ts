/**
 * SPEC-301 §3.1-9 — idle ambient micro-wander (DEFAULT OFF, non-load-bearing).
 *
 * A small station-local jitter applied to an arrived idle orc's `renderedPos` ONLY. It is a
 * PURE, DETERMINISTIC function of (paneId, shared-clock t): the same orc at the same `t`
 * always yields the same offset (no Math.random / Date.now — INV-1 deterministic paths).
 *
 * The offset is a per-pane-phased Lissajous path bounded strictly inside `WANDER_R`
 * (amplitudes satisfy ax² + ay² ≤ 1), so it never changes the logical target/slot and keeps
 * zero layout shift (it only feeds the transform written each shared-clock tick). It is
 * gated OFF by default and disabled under prefers-reduced-motion by the caller
 * (RoamingController), so it has no effect on any AC-01..14 outcome when off.
 */
import { WANDER_FREQ, WANDER_R, type Vec2 } from './stations';

/** Deterministic 32-bit FNV-1a hash of the paneId (the wander seed). */
export function paneHash(paneId: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < paneId.length; i += 1) {
    h ^= paneId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Lissajous amplitudes: 0.8² + 0.55² = 0.9425 ≤ 1 ⇒ |offset| ≤ WANDER_R (bounded).
const AMP_X = 0.8;
const AMP_Y = 0.55;

/**
 * Deterministic micro-wander offset for `paneId` at shared-clock time `t` (ms). Bounded
 * inside `radius` (default WANDER_R). Pure: depends only on (paneId, t, radius).
 */
export function wanderOffset(paneId: string, t: number, radius: number = WANDER_R): Vec2 {
  const h = paneHash(paneId);
  // Per-pane phase + frequency jitter (deterministic) so peers don't drift in lockstep.
  const phaseX = ((h & 0x3ff) / 0x3ff) * Math.PI * 2;
  const phaseY = (((h >>> 10) & 0x3ff) / 0x3ff) * Math.PI * 2;
  const fx = WANDER_FREQ * (0.7 + ((h >>> 20) & 0xff) / 0xff * 0.6);
  const fy = WANDER_FREQ * (0.7 + ((h >>> 24) & 0xff) / 0xff * 0.6);
  return {
    x: Math.sin(t * fx + phaseX) * radius * AMP_X,
    y: Math.cos(t * fy + phaseY) * radius * AMP_Y,
  };
}
