/**
 * SPEC-101 §2.3 — snapshot diff (version-bump decision).
 *
 * Compares two ScanResults by STABLE id, ignoring liveness-only fields
 * (scannedAt/lastGoodAt/scanDurationMs/lastActivityAt), and reports whether the
 * CONTENT changed. A content change is what bumps snapshotVersion (§2.2/§3.1):
 *   - orc added/removed/status-changed/metadata-changed (summary/cwd/command/target/type)
 *   - camp added/removed/aggregate-changed (orcCount/statusSummary)
 *   - top-level transition: stale, tmux availability, diagnostics error count
 *
 * A pure, deterministic content projection compared by stable serialization.
 */
import type { Camp, Orc, ScanResult } from '../types';

function orcContent(o: Orc): unknown {
  return [o.id, o.agentType, o.status, o.currentWorkSummary, o.summarySource, o.cwd, o.command, o.tmuxTarget];
}

function campContent(c: Camp): unknown {
  return [
    c.id,
    c.orcCount,
    c.statusSummary.active,
    c.statusSummary.waiting,
    c.statusSummary.idle,
    c.statusSummary.stale,
    c.statusSummary.error,
    c.statusSummary.unknown,
    c.statusSummary.terminated,
    c.orcs.map(orcContent), // already sorted by assemble (window→pane)
  ];
}

/** Stable content projection (timestamps excluded). */
export function projectContent(scan: ScanResult): string {
  return JSON.stringify([
    scan.stale,
    scan.tmux.installed,
    scan.tmux.serverRunning,
    scan.diagnostics.tmuxErrors.length,
    scan.statusSummary,
    scan.camps.map(campContent), // already sorted by assemble (session name)
  ]);
}

/** True if `next` differs from `prior` in any version-bumping content way. */
export function snapshotChanged(prior: ScanResult | null, next: ScanResult): boolean {
  if (prior === null) return true; // first publish
  return projectContent(prior) !== projectContent(next);
}
