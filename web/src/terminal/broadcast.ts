/**
 * SPEC-203 §2.10 + SPEC-402 client — pure broadcast helpers (no React, no I/O). Target-set build /
 * de-dup / bulk presets, the batch severity mapping (mirrors SPEC-402 §2.7), the summary line, and
 * request-level error copy. Selection is client-side (SPEC-402 §2.8) — the server re-validates every
 * `expected`, so these helpers only shape what the operator confirms and what the server receives.
 */
import type { BroadcastResult, BroadcastTarget, ExpectedTarget } from '../types/api';
import type { Orc, OrcStatus } from '../types/domain';

export type ToastSeverity = 'info' | 'warn' | 'error';

/** The confirm/rail row identity for one target — display-only fields (D-051 (a): no cwd, +paneId). */
export interface BroadcastRow {
  orcId: string;
  paneId: string;
  tmuxTarget: string;
  agentType: Orc['agentType'];
  /** The orc's running command — labelled "running", never "command" (§2.10 P1-O). */
  running: string;
}

function expectedOf(orc: Orc): ExpectedTarget {
  return { paneId: orc.paneId, tmuxTarget: orc.tmuxTarget, command: orc.command, agentType: orc.agentType };
}

/** Build server `targets[]` from a selected id set, de-duped first-wins, camp order preserved. */
export function buildTargets(orderedIds: readonly string[], selected: ReadonlySet<string>, orcsById: Record<string, Orc>): BroadcastTarget[] {
  const seen = new Set<string>();
  const out: BroadcastTarget[] = [];
  for (const id of orderedIds) {
    if (!selected.has(id) || seen.has(id)) continue;
    const orc = orcsById[id];
    if (!orc) continue;
    seen.add(id);
    out.push({ orcId: id, expected: expectedOf(orc) });
  }
  return out;
}

/** Confirm-modal rows for a target set (same order as {@link buildTargets}). */
export function buildRows(orderedIds: readonly string[], selected: ReadonlySet<string>, orcsById: Record<string, Orc>): BroadcastRow[] {
  const seen = new Set<string>();
  const rows: BroadcastRow[] = [];
  for (const id of orderedIds) {
    if (!selected.has(id) || seen.has(id)) continue;
    const orc = orcsById[id];
    if (!orc) continue;
    seen.add(id);
    rows.push({ orcId: id, paneId: orc.paneId, tmuxTarget: orc.tmuxTarget, agentType: orc.agentType, running: orc.command });
  }
  return rows;
}

/** Bulk preset: ids of orcs in the current camp matching a status class (§2.10 waiting/active). */
export function bulkSelect(orderedIds: readonly string[], orcsById: Record<string, Orc>, kind: 'waiting' | 'active'): string[] {
  const want: OrcStatus = kind === 'waiting' ? 'waiting' : 'active';
  return orderedIds.filter((id) => orcsById[id]?.status === want);
}

/** SPEC-402 §2.7 — batch severity: all-ok → info, some fail → warn, all fail → error. */
export function broadcastSeverity(successCount: number, failureCount: number): ToastSeverity {
  if (failureCount === 0) return 'info';
  if (successCount === 0) return 'error';
  return 'warn';
}

export interface BroadcastSummary {
  severity: ToastSeverity;
  message: string;
}

/** One-line summary toast copy for a completed broadcast (severity matches the batch, §2.10). */
export function summarizeBroadcast(result: BroadcastResult): BroadcastSummary {
  const { successCount, failureCount, targetCount } = result;
  const severity = broadcastSeverity(successCount, failureCount);
  if (failureCount === 0) return { severity, message: `Broadcast sent to ${targetCount} agent${targetCount === 1 ? '' : 's'}.` };
  if (successCount === 0) return { severity, message: `Broadcast failed for all ${targetCount} agents — review failures.` };
  return { severity, message: `Broadcast: ${successCount} sent, ${failureCount} failed — review failures.` };
}

/** Request-level (whole-broadcast) error copy — distinct from per-orc results (SPEC-402 §2.9). */
export function broadcastErrorMessage(code: string, message: string): string {
  switch (code) {
    case 'confirm_required':
      return 'Confirmation required to broadcast.';
    case 'out_of_camp_scope':
      return 'A target is outside this camp — broadcast cancelled.';
    case 'too_many_targets':
      return 'Too many targets for one broadcast.';
    case 'rate_limited':
      return 'Rate limited — slow down and retry.';
    case 'validation_error':
      return message || 'Invalid broadcast request.';
    case 'unauthorized':
      return 'Not authorized. Re-open the boot URL.';
    case 'network_error':
      return 'Could not reach the local server. Is it still running?';
    default:
      return message || 'Broadcast failed.';
  }
}
