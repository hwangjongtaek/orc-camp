/**
 * SPEC-203 §2.5 — orc switching helpers (pure, testable). The rail order is the SSOT for
 * prev/next (S2) and digit-jump (S3); all switches converge on `onSelectOrc` → `?orc=`
 * (invariant ①). The quick-switcher (S4) filters by name/target/status (fuzzy subsequence).
 */
import type { OrcStatus } from '../types/domain';

/**
 * SPEC-203 §2.3 — rail display order: `waiting` orcs are promoted to a top group (orchestration
 * emphasis), otherwise the original snapshot order is preserved (stable within each group). This
 * order is the SSOT for prev/next (S2) and digit-jump (S3) so keyboard motion matches what is seen.
 */
export function railOrder(
  orderedIds: readonly string[],
  isWaiting: (orcId: string) => boolean,
): string[] {
  const waiting: string[] = [];
  const rest: string[] = [];
  for (const id of orderedIds) (isWaiting(id) ? waiting : rest).push(id);
  return waiting.concat(rest);
}

/** Rail-order neighbor for `[`/`]` (S2). Wraps around; null only when the list is empty. */
export function prevOrc(orderedIds: readonly string[], current: string | null): string | null {
  return neighbor(orderedIds, current, -1);
}
export function nextOrc(orderedIds: readonly string[], current: string | null): string | null {
  return neighbor(orderedIds, current, +1);
}

function neighbor(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = current ? ids.indexOf(current) : -1;
  if (i < 0) return dir > 0 ? ids[0]! : ids[ids.length - 1]!;
  const n = (i + dir + ids.length) % ids.length;
  return ids[n]!;
}

/** Rail-ordinal jump for Alt+1..9 (S3). `n` is 1-based; out-of-range → null (no-op). */
export function digitJump(orderedIds: readonly string[], n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 9) return null;
  return orderedIds[n - 1] ?? null;
}

export interface SwitchableItem {
  orcId: string;
  tmuxTarget: string;
  summaryLine: string;
  status: OrcStatus;
}

/**
 * Quick-switcher fuzzy filter (S4). Empty query → all (rail order preserved). Otherwise a
 * case-insensitive SUBSEQUENCE match across `tmuxTarget + status + summaryLine`, ranked by a
 * simple contiguity/earliness score (best first, ties keep rail order — stable sort).
 */
export function fuzzyFilter<T extends SwitchableItem>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return items.slice();
  const scored: Array<{ item: T; score: number; idx: number }> = [];
  items.forEach((item, idx) => {
    const hay = `${item.tmuxTarget} ${item.status} ${item.summaryLine}`.toLowerCase();
    const score = subsequenceScore(hay, q);
    if (score !== null) scored.push({ item, score, idx });
  });
  scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.idx - b.idx));
  return scored.map((s) => s.item);
}

/** Higher = better; null = not a subsequence. Rewards contiguous runs and an early first match. */
function subsequenceScore(hay: string, needle: string): number | null {
  let hi = 0;
  let score = 0;
  let firstAt = -1;
  let prevMatch = -2;
  for (let ni = 0; ni < needle.length; ni++) {
    const ch = needle[ni]!;
    let found = -1;
    for (; hi < hay.length; hi++) {
      if (hay[hi] === ch) {
        found = hi;
        break;
      }
    }
    if (found < 0) return null;
    if (firstAt < 0) firstAt = found;
    if (found === prevMatch + 1) score += 2; // contiguous run bonus
    prevMatch = found;
    hi = found + 1;
  }
  // earlier first match = better (small penalty for late start)
  return score - firstAt * 0.01;
}
