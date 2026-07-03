/**
 * SPEC-203 §2.10 + SPEC-402 client — broadcast orchestration state + execution. Owns the selection
 * mode, the `broadcastTargeted` set (orthogonal to `?orc=`), the confirm gate, and the single
 * `POST /api/camps/:campId/broadcast` call whose per-orc results are aggregated back onto the rail.
 *
 * Invariants held here: broadcast uses ONLY the form path (this hook never arms/passthroughs — D-050);
 * N≥2 always sends `confirmed:true` AFTER the ConfirmModal (§2.3); every target's `expected` is sent
 * for server re-validation (client selection is not trusted, §2.4/§2.8); best-effort partial results
 * are surfaced, never hidden (§2.6). Entering/leaving the mode never changes the switch selection.
 */
import { useCallback, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { useStore } from '../../store/store';
import {
  bulkSelect,
  buildRows,
  buildTargets,
  broadcastErrorMessage,
  summarizeBroadcast,
  type BroadcastRow,
} from '../../terminal/broadcast';
import type { Orc } from '../../types/domain';

export interface OrcRailResult {
  ok: boolean;
  errorCode: string | null;
}

export interface BroadcastState {
  mode: boolean;
  targeted: ReadonlySet<string>;
  count: number;
  confirmOpen: boolean;
  confirmInitialText: string;
  confirmRows: BroadcastRow[];
  resultById: ReadonlyMap<string, OrcRailResult>;
  busy: boolean;
}

export interface BroadcastActions {
  enter: () => void;
  exit: () => void;
  toggle: (orcId: string) => void;
  bulk: (kind: 'waiting' | 'active') => void;
  clear: () => void;
  openConfirm: () => void;
  /** Waiting-toast affordance: pre-select a snapshot set and open the confirm (never touches ?orc=). */
  openFromWaiting: (waitingIds: string[]) => void;
  cancelConfirm: () => void;
  execute: (text: string) => Promise<void>;
  retryFailed: () => void;
}

export interface UseBroadcastParams {
  campId: string;
  orderedIds: readonly string[];
  orcsById: Record<string, Orc>;
}

function errorSeverity(code: string): 'warn' | 'error' {
  return code === 'confirm_required' || code === 'rate_limited' ? 'warn' : 'error';
}

export function useBroadcast({ campId, orderedIds, orcsById }: UseBroadcastParams): [BroadcastState, BroadcastActions] {
  const { api } = useServices();
  const addToast = useStore((s) => s.addToast);

  const [mode, setMode] = useState(false);
  const [targeted, setTargeted] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInitialText, setConfirmInitialText] = useState('');
  const [resultById, setResultById] = useState<ReadonlyMap<string, OrcRailResult>>(() => new Map());
  const [busy, setBusy] = useState(false);

  // Latest snapshot inputs for stable callbacks (targets are always built in camp order at fire time).
  const orderedRef = useRef(orderedIds);
  const orcsRef = useRef(orcsById);
  const targetedRef = useRef(targeted);
  const resultByIdRef = useRef(resultById);
  const lastTextRef = useRef('');
  orderedRef.current = orderedIds;
  orcsRef.current = orcsById;
  targetedRef.current = targeted;
  resultByIdRef.current = resultById;

  const enter = useCallback(() => setMode(true), []);
  const exit = useCallback(() => {
    setMode(false);
    setConfirmOpen(false);
    setTargeted(new Set());
    setResultById(new Map());
  }, []);

  const toggle = useCallback((orcId: string) => {
    setTargeted((prev) => {
      const next = new Set(prev);
      if (next.has(orcId)) next.delete(orcId);
      else next.add(orcId);
      return next;
    });
  }, []);

  const bulk = useCallback((kind: 'waiting' | 'active') => {
    const ids = bulkSelect(orderedRef.current, orcsRef.current, kind);
    setTargeted((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setTargeted(new Set()), []);

  const openConfirm = useCallback(() => {
    if (targetedRef.current.size === 0) return;
    setConfirmInitialText('');
    setConfirmOpen(true);
  }, []);

  const openFromWaiting = useCallback((waitingIds: string[]) => {
    setMode(true);
    setResultById(new Map());
    setTargeted(new Set(waitingIds));
    setConfirmInitialText('');
    setConfirmOpen(true);
  }, []);

  const cancelConfirm = useCallback(() => setConfirmOpen(false), []);

  const execute = useCallback(
    async (text: string): Promise<void> => {
      const targets = buildTargets(orderedRef.current, targetedRef.current, orcsRef.current);
      if (targets.length === 0) {
        setConfirmOpen(false);
        return;
      }
      lastTextRef.current = text;
      setBusy(true);
      const res = await api.broadcastCamp(campId, {
        input: { text, submit: true },
        targets,
        ...(targets.length >= 2 ? { confirmed: true } : {}),
      });
      setBusy(false);
      setConfirmOpen(false);
      if (res.ok) {
        setResultById(new Map(res.data.results.map((r) => [r.orcId, { ok: r.ok, errorCode: r.errorCode }])));
        const { severity, message } = summarizeBroadcast(res.data);
        // Durable failure surface: per-orc failures also land on the Activity Rail (control.result N +
        // control.broadcast 1). The summary toast additionally offers to re-open the confirm with the
        // failed subset pre-selected — the server re-validates every target again (§2.10, AC-18 iii).
        const failedIds = res.data.results.filter((r) => !r.ok).map((r) => r.orcId);
        const retryAction =
          failedIds.length > 0
            ? {
                label: `Retry ${failedIds.length} failed`,
                onClick: () => {
                  setMode(true);
                  setTargeted(new Set(failedIds));
                  setConfirmInitialText(lastTextRef.current);
                  setConfirmOpen(true);
                },
              }
            : undefined;
        addToast(severity, message, retryAction);
      } else {
        addToast(errorSeverity(res.error.code), broadcastErrorMessage(res.error.code, res.error.message));
      }
    },
    [api, campId, addToast],
  );

  const retryFailed = useCallback(() => {
    // Re-select the failed subset from the latest results and re-open the confirm (server re-validates).
    const failed = new Set<string>();
    for (const [id, r] of resultByIdRef.current) if (!r.ok) failed.add(id);
    if (failed.size === 0) return;
    setMode(true);
    setTargeted(failed);
    setConfirmInitialText(lastTextRef.current);
    setConfirmOpen(true);
  }, []);

  const confirmRows = buildRows(orderedIds, targeted, orcsById);

  return [
    { mode, targeted, count: targeted.size, confirmOpen, confirmInitialText, confirmRows, resultById, busy },
    { enter, exit, toggle, bulk, clear, openConfirm, openFromWaiting, cancelConfirm, execute, retryFailed },
  ];
}
