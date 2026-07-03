/**
 * SPEC-203 §2.9 — waiting-transition toasts (orchestration nudge). Mounted only inside the Terminal
 * Workspace, so the "terminal mode" utterance condition is structural. Watches the store's orc
 * stream (snapshot + diff writes both land in `orcsById`); each change re-scans for active→waiting
 * edges via {@link scanWaitingTransitions} and fires a clickable "View" toast that selects (→ ?orc=)
 * the waiting orc. Baselines/cooldowns live in refs so only the orc stream drives re-detection.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../../store/store';
import { WAITING_TOAST_COOLDOWN_MS } from '../../config/constants';
import { scanWaitingTransitions } from '../../terminal/waitingToasts';
import type { OrcStatus, Orc } from '../../types/domain';

export interface UseWaitingToastsParams {
  orderedIds: readonly string[];
  orcsById: Record<string, Orc>;
  selectedOrcId: string | null;
  onSelectOrc: (orcId: string) => void;
  /**
   * SPEC-203 §2.10 (P1-P) — "Broadcast to all waiting" affordance. When ≥2 orcs are waiting at fire
   * time, the toast gets a de-emphasized secondary action that pre-selects that snapshot set and
   * opens the broadcast confirm (never changes `?orc=`).
   */
  onBroadcastWaiting?: (waitingIds: string[]) => void;
}

export function useWaitingToasts(params: UseWaitingToastsParams): void {
  const { orderedIds, orcsById, selectedOrcId, onSelectOrc, onBroadcastWaiting } = params;
  const addToast = useStore((s) => s.addToast);

  const prevRef = useRef<Map<string, OrcStatus>>(new Map());
  const lastToastAtRef = useRef<Map<string, number>>(new Map());
  // Read the latest selection / handler at fire time without re-running detection on their change.
  const selectedRef = useRef(selectedOrcId);
  const onSelectRef = useRef(onSelectOrc);
  const onBroadcastRef = useRef(onBroadcastWaiting);
  selectedRef.current = selectedOrcId;
  onSelectRef.current = onSelectOrc;
  onBroadcastRef.current = onBroadcastWaiting;

  useEffect(() => {
    const res = scanWaitingTransitions({
      orderedIds,
      statusById: (id) => orcsById[id]?.status,
      selectedOrcId: selectedRef.current,
      prev: prevRef.current,
      lastToastAt: lastToastAtRef.current,
      now: Date.now(),
      cooldownMs: WAITING_TOAST_COOLDOWN_MS,
    });
    prevRef.current = res.nextPrev;
    lastToastAtRef.current = res.nextLastToastAt;

    if (res.announce.length === 0) return;

    // Snapshot of ALL currently-waiting orcs (for the mass "broadcast to all waiting" affordance).
    const waitingIds = orderedIds.filter((id) => orcsById[id]?.status === 'waiting');
    const onBroadcast = onBroadcastRef.current;

    for (const id of res.announce) {
      const orc = orcsById[id];
      if (!orc) continue;
      const secondary =
        onBroadcast && waitingIds.length >= 2
          ? {
              label: `Broadcast to ${waitingIds.length} waiting`,
              onClick: () => onBroadcast([...waitingIds]),
            }
          : undefined;
      addToast(
        'info',
        `${orc.tmuxTarget} is waiting for input`,
        { label: 'View', onClick: () => onSelectRef.current(id) },
        secondary,
      );
    }
  }, [orderedIds, orcsById, addToast]);
}
