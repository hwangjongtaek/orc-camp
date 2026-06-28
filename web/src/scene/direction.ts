/**
 * SPEC-301 §3.1-2 — 8-direction quantize (half-open buckets, deterministic boundaries).
 *
 * The movement vector angle is bucketed into ±22.5° half-open intervals
 * `[center − 22.5°, center + 22.5°)` and mapped to a manifest `roaming.folders` name.
 * Boundary angles (exact multiples of 22.5°) always fall to the UPPER bucket, so there is
 * no tie. South is the fallback when a direction folder is unavailable (delegated to the
 * resolver per SPEC-300 §3.2-4); this module only names the geometric direction.
 */
import { MVP_DIRECTION } from './stations';

/** bucket index (from the §3.1-2 formula) → manifest direction name. */
const BUCKET_TO_DIR = [
  'west', // 0  → [157.5°,180°] ∪ [−180°,−157.5°)
  'north-west', // 1
  'north', // 2
  'north-east', // 3
  'east', // 4  → [−22.5°,+22.5°)
  'south-east', // 5
  'south', // 6
  'south-west', // 7
] as const;

export const DIRECTIONS = BUCKET_TO_DIR;

/**
 * Quantize a screen-space angle (degrees, y-down) to an 8-direction name.
 * Implements the spec formula `bucket = floor((deg + 180 + 22.5) / 45) mod 8`.
 */
export function quantizeAngle(deg: number): string {
  // Normalize into (−180, 180] first so wrap (±180 → west) is single-bucketed.
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  const bucket = Math.floor((d + 180 + 22.5) / 45) % 8;
  return BUCKET_TO_DIR[bucket] ?? MVP_DIRECTION;
}

/**
 * Quantize a screen-space movement vector (dx right+, dy down+) to a direction name.
 * Returns south for a zero vector (no movement → facing south, MVP).
 */
export function quantizeVector(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return MVP_DIRECTION;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return quantizeAngle(deg);
}
