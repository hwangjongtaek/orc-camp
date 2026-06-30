import type { Camp, Orc, ScanResult, StatusSummary } from '../src/types/domain';
import { EMPTY_STATUS_SUMMARY } from '../src/types/domain';

export function summary(p: Partial<StatusSummary> = {}): StatusSummary {
  return { ...EMPTY_STATUS_SUMMARY, ...p };
}

export function makeOrc(p: Partial<Orc> & { paneId: string }): Orc {
  const id = `pane:${p.paneId}`;
  return {
    id,
    paneId: p.paneId,
    tmuxTarget: p.tmuxTarget ?? `work:0.${p.paneIndex ?? 0}`,
    sessionName: p.sessionName ?? 'work',
    windowIndex: p.windowIndex ?? 0,
    paneIndex: p.paneIndex ?? 0,
    cwd: p.cwd ?? '/home/u/project',
    command: p.command ?? 'node',
    agentType: p.agentType ?? 'claude-code',
    agentTypeConfidence: p.agentTypeConfidence ?? 0.9,
    agentSignals: p.agentSignals ?? [],
    status: p.status ?? 'idle',
    statusConfidence: p.statusConfidence ?? 0.7,
    statusSignals: p.statusSignals ?? [],
    currentWorkSummary: p.currentWorkSummary ?? null,
    summarySource: p.summarySource ?? 'unknown',
    summaryIsEstimated: p.summaryIsEstimated ?? true,
    lastActivityAt: p.lastActivityAt ?? '2026-06-27T00:00:00.000Z',
    preview: p.preview ?? null,
    usage: p.usage ?? null,
  };
}

export function makeCamp(p: Partial<Camp> & { sessionId: string; orcs?: Orc[] }): Camp {
  const orcs = p.orcs ?? [];
  return {
    id: `session:${p.sessionId}`,
    sessionId: p.sessionId,
    tmuxSessionName: p.tmuxSessionName ?? p.sessionId,
    windowCount: p.windowCount ?? 1,
    paneCount: p.paneCount ?? orcs.length,
    orcCount: orcs.length,
    statusSummary: p.statusSummary ?? summary(),
    lastActivityAt: p.lastActivityAt ?? null,
    orcs,
  };
}

export function makeScan(p: Partial<ScanResult> & { camps: Camp[] }): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: p.scannedAt ?? '2026-06-27T00:00:00.000Z',
    stale: p.stale ?? false,
    lastGoodAt: p.lastGoodAt ?? '2026-06-27T00:00:00.000Z',
    tmux: p.tmux ?? { installed: true, serverRunning: true, version: '3.4' },
    statusSummary: p.statusSummary ?? summary(),
    camps: p.camps,
    diagnostics: p.diagnostics ?? { tmuxErrors: [], scanDurationMs: 5 },
  };
}
