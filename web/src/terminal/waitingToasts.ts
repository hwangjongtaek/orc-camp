/**
 * SPEC-203 §2.9 — waiting-transition detection (pure). Orchestration nudge: when an orc that was
 * `active` flips to `waiting` for input, the other panes' operator should be told without hunting.
 *
 * Utterance conditions (all must hold): a genuine active→waiting *edge* (not an orc already waiting
 * on entry), the orc is NOT the one currently selected (you can already see it), and the per-orc
 * reduced-noise cooldown has lapsed (flapping between scans must not spam). This module owns only
 * the decision; the hook wraps it with the real clock and fires `addToast`.
 */
import type { OrcStatus } from '../types/domain';

export interface WaitingScanInput {
  orderedIds: readonly string[];
  statusById: (id: string) => OrcStatus | undefined;
  selectedOrcId: string | null;
  /** Last observed status per orc (baseline from the previous scan). */
  prev: ReadonlyMap<string, OrcStatus>;
  /** Timestamp (ms) each orc last announced, for the cooldown gate. */
  lastToastAt: ReadonlyMap<string, number>;
  now: number;
  cooldownMs: number;
}

export interface WaitingScanResult {
  /** Orc ids that should announce a waiting toast this scan (in `orderedIds` order). */
  announce: string[];
  /** New baseline to carry into the next scan. */
  nextPrev: Map<string, OrcStatus>;
  /** New cooldown map (pruned to present orcs). */
  nextLastToastAt: Map<string, number>;
}

export function scanWaitingTransitions(input: WaitingScanInput): WaitingScanResult {
  const announce: string[] = [];
  const nextPrev = new Map<string, OrcStatus>();
  const nextLastToastAt = new Map<string, number>();

  for (const id of input.orderedIds) {
    const status = input.statusById(id);
    if (status === undefined) continue;
    nextPrev.set(id, status);
    // carry the cooldown timestamp forward only for orcs that still exist (prune the gone)
    const carried = input.lastToastAt.get(id);
    if (carried !== undefined) nextLastToastAt.set(id, carried);

    const before = input.prev.get(id);
    const isEdge = before === 'active' && status === 'waiting';
    if (!isEdge || id === input.selectedOrcId) continue;

    const last = input.lastToastAt.get(id);
    if (last !== undefined && input.now - last < input.cooldownMs) continue;

    announce.push(id);
    nextLastToastAt.set(id, input.now);
  }

  return { announce, nextPrev, nextLastToastAt };
}
