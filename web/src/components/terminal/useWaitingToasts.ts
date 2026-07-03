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
}

export function useWaitingToasts(params: UseWaitingToastsParams): void {
  const { orderedIds, orcsById, selectedOrcId, onSelectOrc } = params;
  const addToast = useStore((s) => s.addToast);

  const prevRef = useRef<Map<string, OrcStatus>>(new Map());
  const lastToastAtRef = useRef<Map<string, number>>(new Map());
  // Read the latest selection / handler at fire time without re-running detection on their change.
  const selectedRef = useRef(selectedOrcId);
  const onSelectRef = useRef(onSelectOrc);
  selectedRef.current = selectedOrcId;
  onSelectRef.current = onSelectOrc;

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

    for (const id of res.announce) {
      const orc = orcsById[id];
      if (!orc) continue;
      addToast('info', `${orc.tmuxTarget} is waiting for input`, {
        label: 'View',
        onClick: () => onSelectRef.current(id),
      });
    }
  }, [orderedIds, orcsById, addToast]);
}
