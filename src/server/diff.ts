/**
 * SPEC-101 §2.3 + SPEC-102 §2.3.1 — snapshot diff.
 *
 * `snapshotChanged` decides the version bump (content projection compare, timestamps
 * excluded). `diffSnapshots` produces the convergent, id-keyed change EVENTS that
 * SPEC-102 streams over WebSocket (camp/orc added/removed/updated/status_changed).
 */
import type { Camp, Orc, ScanResult, StatusSummary } from '../types';

function orcContent(o: Orc): unknown {
  return [o.id, o.agentType, o.status, o.currentWorkSummary, o.summarySource, o.cwd, o.command, o.tmuxTarget];
}
function campContent(c: Camp): unknown {
  return [c.id, c.orcCount, summaryTuple(c.statusSummary), c.orcs.map(orcContent)];
}
function summaryTuple(s: StatusSummary): unknown {
  return [s.active, s.waiting, s.idle, s.stale, s.error, s.unknown, s.terminated];
}

export function projectContent(scan: ScanResult): string {
  return JSON.stringify([
    scan.stale,
    scan.tmux.installed,
    scan.tmux.serverRunning,
    scan.diagnostics.tmuxErrors.length,
    summaryTuple(scan.statusSummary),
    scan.camps.map(campContent),
  ]);
}

export function snapshotChanged(prior: ScanResult | null, next: ScanResult): boolean {
  if (prior === null) return true;
  return projectContent(prior) !== projectContent(next);
}

// --- SPEC-102 §2.3.1 change events ------------------------------------------

export type DiffEventType =
  | 'camp_added'
  | 'camp_removed'
  | 'camp_updated'
  | 'orc_added'
  | 'orc_updated'
  | 'orc_status_changed'
  | 'orc_removed';

export interface DiffEvent {
  type: DiffEventType;
  payload: Record<string, unknown>;
}

function statusChanged(a: Orc, b: Orc): boolean {
  return (
    a.status !== b.status ||
    a.statusConfidence !== b.statusConfidence ||
    a.currentWorkSummary !== b.currentWorkSummary ||
    a.summarySource !== b.summarySource ||
    a.summaryIsEstimated !== b.summaryIsEstimated
  );
}
function metaChanged(a: Orc, b: Orc): boolean {
  return a.cwd !== b.cwd || a.command !== b.command || a.tmuxTarget !== b.tmuxTarget;
}

function diffCampMeta(prior: Camp, next: Camp): DiffEvent | null {
  const changed: Record<string, unknown> = { campId: next.id };
  let any = false;
  if (prior.tmuxSessionName !== next.tmuxSessionName) { changed.tmuxSessionName = next.tmuxSessionName; any = true; }
  if (prior.windowCount !== next.windowCount) { changed.windowCount = next.windowCount; any = true; }
  if (prior.paneCount !== next.paneCount) { changed.paneCount = next.paneCount; any = true; }
  if (summaryTuple(prior.statusSummary) + '' !== summaryTuple(next.statusSummary) + '') { changed.statusSummary = next.statusSummary; any = true; }
  if (prior.lastActivityAt !== next.lastActivityAt) { changed.lastActivityAt = next.lastActivityAt; any = true; }
  return any ? { type: 'camp_updated', payload: changed } : null;
}

export function diffSnapshots(prior: ScanResult | null, next: ScanResult): DiffEvent[] {
  const events: DiffEvent[] = [];
  const priorCamps = new Map((prior?.camps ?? []).map((c) => [c.id, c]));
  const nextCamps = new Map(next.camps.map((c) => [c.id, c]));

  for (const [id, pc] of priorCamps) {
    if (!nextCamps.has(id)) events.push({ type: 'camp_removed', payload: { campId: id } });
    void pc;
  }
  for (const [id, nc] of nextCamps) {
    const pc = priorCamps.get(id);
    if (!pc) {
      events.push({ type: 'camp_added', payload: { data: nc } });
      continue;
    }
    const meta = diffCampMeta(pc, nc);
    if (meta) events.push(meta);

    const priorOrcs = new Map(pc.orcs.map((o) => [o.id, o]));
    const nextOrcs = new Map(nc.orcs.map((o) => [o.id, o]));
    for (const [oid] of priorOrcs) {
      if (!nextOrcs.has(oid)) events.push({ type: 'orc_removed', payload: { campId: id, orcId: oid, reason: 'pane_closed' } });
    }
    for (const [oid, no] of nextOrcs) {
      const po = priorOrcs.get(oid);
      if (!po) {
        events.push({ type: 'orc_added', payload: { campId: id, data: no } });
        continue;
      }
      if (statusChanged(po, no)) {
        events.push({
          type: 'orc_status_changed',
          payload: {
            campId: id, orcId: oid, status: no.status, statusConfidence: no.statusConfidence,
            statusSignals: no.statusSignals, currentWorkSummary: no.currentWorkSummary,
            summarySource: no.summarySource, summaryIsEstimated: no.summaryIsEstimated, lastActivityAt: no.lastActivityAt,
          },
        });
      } else if (metaChanged(po, no)) {
        events.push({
          type: 'orc_updated',
          payload: { campId: id, orcId: oid, cwd: no.cwd, command: no.command, tmuxTarget: no.tmuxTarget },
        });
      }
    }
  }
  return events;
}
