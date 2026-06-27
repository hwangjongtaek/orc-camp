/**
 * SPEC-200 §2.5 — client-side reconcile model (the testable core).
 *
 * `decideOutcome` enforces version ordering (drop ≤Vlast / apply =Vlast+1 / resync gap or
 * epoch mismatch). `applyChanges` performs the convergent, id-keyed merge ATOMICALLY: it
 * mutates a working copy and, on any unknown-id reference, returns `{ok:false}` so the
 * caller resyncs (conservative, SPEC-102 §3.2-4) rather than committing a partial batch.
 */
import type { DiffEvent } from '../types/ws';
import {
  campMeta,
  sortCampIds,
  sortOrcIds,
  type ServerData,
} from '../store/serverData';

export type ReconcileOutcome = 'applied' | 'dropped' | 'resync-required';

export interface OutcomeInput {
  version: number;
  frameEpoch: string;
  runtimeEpoch: string | null;
  lastVersionApplied: number;
}

export function decideOutcome(input: OutcomeInput): ReconcileOutcome {
  const { version, frameEpoch, runtimeEpoch, lastVersionApplied } = input;
  if (runtimeEpoch !== null && frameEpoch !== runtimeEpoch) return 'resync-required';
  if (version <= lastVersionApplied) return 'dropped';
  if (version === lastVersionApplied + 1) return 'applied';
  return 'resync-required';
}

/** Sentinel used internally to abort an atomic batch on an unknown-id reference. */
class ResyncRequired extends Error {}

function shallowCloneServer(prev: ServerData): ServerData {
  return {
    ...prev,
    statusSummary: { ...prev.statusSummary },
    diagnostics: { ...prev.diagnostics, tmuxErrors: [...prev.diagnostics.tmuxErrors] },
    campIds: [...prev.campIds],
    campsById: { ...prev.campsById },
    orcIdsByCamp: { ...prev.orcIdsByCamp },
    orcsById: { ...prev.orcsById },
  };
}

function applyOne(next: ServerData, ev: DiffEvent): void {
  switch (ev.type) {
    case 'camp_added': {
      const camp = ev.payload.data;
      next.campsById[camp.id] = campMeta(camp);
      const orcIds: string[] = [];
      for (const orc of camp.orcs) {
        next.orcsById[orc.id] = orc;
        orcIds.push(orc.id);
      }
      next.orcIdsByCamp[camp.id] = sortOrcIds(next.orcsById, orcIds);
      if (!next.campIds.includes(camp.id)) next.campIds.push(camp.id);
      next.campIds = sortCampIds(next.campsById, next.campIds);
      break;
    }
    case 'camp_removed': {
      const { campId } = ev.payload;
      for (const orcId of next.orcIdsByCamp[campId] ?? []) delete next.orcsById[orcId];
      delete next.orcIdsByCamp[campId];
      delete next.campsById[campId];
      next.campIds = next.campIds.filter((id) => id !== campId);
      break;
    }
    case 'camp_updated': {
      const p = ev.payload;
      const meta = next.campsById[p.campId];
      if (!meta) throw new ResyncRequired();
      const merged = { ...meta };
      if (p.tmuxSessionName !== undefined) merged.tmuxSessionName = p.tmuxSessionName;
      if (p.windowCount !== undefined) merged.windowCount = p.windowCount;
      if (p.paneCount !== undefined) merged.paneCount = p.paneCount;
      if (p.statusSummary !== undefined) merged.statusSummary = p.statusSummary;
      if (p.lastActivityAt !== undefined) merged.lastActivityAt = p.lastActivityAt;
      next.campsById[p.campId] = merged;
      if (p.tmuxSessionName !== undefined) {
        next.campIds = sortCampIds(next.campsById, next.campIds);
      }
      break;
    }
    case 'orc_added': {
      const { campId, data } = ev.payload;
      if (!next.campsById[campId]) throw new ResyncRequired();
      next.orcsById[data.id] = data;
      const ids = [...(next.orcIdsByCamp[campId] ?? [])];
      if (!ids.includes(data.id)) ids.push(data.id);
      next.orcIdsByCamp[campId] = sortOrcIds(next.orcsById, ids);
      break;
    }
    case 'orc_removed': {
      const { campId, orcId } = ev.payload;
      delete next.orcsById[orcId];
      next.orcIdsByCamp[campId] = (next.orcIdsByCamp[campId] ?? []).filter((id) => id !== orcId);
      break;
    }
    case 'orc_status_changed': {
      const p = ev.payload;
      const orc = next.orcsById[p.orcId];
      if (!orc) throw new ResyncRequired();
      next.orcsById[p.orcId] = {
        ...orc,
        status: p.status,
        statusConfidence: p.statusConfidence,
        statusSignals: p.statusSignals,
        currentWorkSummary: p.currentWorkSummary,
        summarySource: p.summarySource,
        summaryIsEstimated: p.summaryIsEstimated,
        lastActivityAt: p.lastActivityAt,
      };
      break;
    }
    case 'orc_updated': {
      const p = ev.payload;
      const orc = next.orcsById[p.orcId];
      if (!orc) throw new ResyncRequired();
      next.orcsById[p.orcId] = {
        ...orc,
        cwd: p.cwd,
        command: p.command,
        tmuxTarget: p.tmuxTarget,
      };
      break;
    }
    default: {
      // Unknown event type → be conservative and resync.
      throw new ResyncRequired();
    }
  }
}

/**
 * Apply a batch of changes atomically against `prev`, bumping snapshotVersion to `version`.
 * Returns the new ServerData on success, or `{ok:false}` if the batch could not be applied
 * cleanly (unknown-id reference) — the caller then performs a full resync.
 */
export function applyChanges(
  prev: ServerData,
  changes: DiffEvent[],
  version: number,
): { ok: true; next: ServerData } | { ok: false } {
  const next = shallowCloneServer(prev);
  try {
    for (const ev of changes) applyOne(next, ev);
  } catch (err) {
    if (err instanceof ResyncRequired) return { ok: false };
    throw err;
  }
  next.snapshotVersion = version;
  return { ok: true, next };
}
