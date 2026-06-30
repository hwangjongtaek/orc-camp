/**
 * SPEC-302 — prestige tier resolution seam (the single place tier is decided for an orc).
 *
 * The full pipeline (cumulative token/cost usage → displayedTier with monotonic latch, D-036) is
 * FORWARD: `Orc.usage` is not yet collected by the scanner (SPEC-005 data contract), so today this
 * returns 0 (base) for every orc. When usage data lands, implement the thresholds here (initial
 * gate: 1M / 5M / 20M tokens) and every tier consumer lights up with NO further change — including
 * the SPEC-304 portrait slot, which already maps displayedTier → that character's tier portrait,
 * and (forward) the SPEC-302 sprite tier variants.
 */
import type { Orc } from '../types/domain';

export type DisplayedTier = 0 | 1 | 2 | 3;

/**
 * The orc's displayed prestige tier (0 = base). Monotonic-latch + usage thresholds are SPEC-302's
 * job once `Orc.usage` exists; until then every orc is base. Pure + deterministic.
 */
export function displayedTierForOrc(_orc: Orc): DisplayedTier {
  return 0;
}
