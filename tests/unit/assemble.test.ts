/**
 * Unit tests for SPEC-005 assembly: camp/orc aggregation, deterministic ordering,
 * id derivation, statusSummary rollup, and preview metadata.
 */
import { describe, expect, it } from 'vitest';
import { assembleScanResult } from '../../src/assemble';
import { detectOrc, defaultDetectors } from '../../src/detection/detect';
import { inferStatus } from '../../src/status/infer';
import { sanitizeCapture } from '../../src/redaction/redact';
import {
  type InventoryResult,
  type PaneRawRecord,
  type PriorOrcState,
  type ProcessNode,
  type SanitizedCapture,
  type SessionRawRecord,
} from '../../src/types';

const SCANNED_AT = '2026-06-27T10:00:00.000Z';

function cap(raw: string): SanitizedCapture {
  return sanitizeCapture(raw);
}

function rec(p: Partial<PaneRawRecord> & Pick<PaneRawRecord, 'paneId' | 'sessionName' | 'windowIndex' | 'paneIndex' | 'command'>): PaneRawRecord {
  return {
    tmuxTarget: `${p.sessionName}:${p.windowIndex}.${p.paneIndex}`,
    paneTitle: null,
    cwd: '/Users/me/proj',
    lastActivityAt: SCANNED_AT,
    panePid: 1000,
    paneDead: false,
    paneActive: true,
    cmdline: null,
    processAlive: null,
    capture: cap('idle'),
    ...p,
  };
}

function inventory(sessions: SessionRawRecord[], panes: PaneRawRecord[]): InventoryResult {
  return {
    availability: { installed: true, serverRunning: true, version: '3.6b' },
    state: 'normal',
    sessions,
    panes,
    errors: [],
    collectedOk: true,
    collectedAt: SCANNED_AT,
  };
}

function assemble(inv: InventoryResult, priors = new Map<string, PriorOrcState>()) {
  return assembleScanResult({
    inventory: inv,
    scannedAt: SCANNED_AT,
    stale: false,
    lastGoodAt: SCANNED_AT,
    scanDurationMs: 7,
    detectOrc,
    inferStatus,
    detectors: defaultDetectors,
    priors,
  });
}

describe('assembly ordering + ids (SPEC-005-AC-04/13)', () => {
  it('sorts camps by name and orcs by window→pane; derives stable ids', async () => {
    const inv = inventory(
      [
        { sessionId: '$2', sessionName: 'zeta', windows: 1, attached: false, activityAt: SCANNED_AT },
        { sessionId: '$1', sessionName: 'alpha', windows: 1, attached: true, activityAt: SCANNED_AT },
      ],
      [
        rec({ paneId: '%20', sessionName: 'alpha', windowIndex: 1, paneIndex: 1, command: 'claude' }),
        rec({ paneId: '%21', sessionName: 'alpha', windowIndex: 1, paneIndex: 0, command: 'claude' }),
        rec({ paneId: '%30', sessionName: 'zeta', windowIndex: 2, paneIndex: 0, command: 'codex' }),
      ],
    );
    const { result } = await assemble(inv);
    expect(result.camps.map((c) => c.tmuxSessionName)).toEqual(['alpha', 'zeta']);
    const alpha = result.camps[0]!;
    expect(alpha.id).toBe('session:$1');
    expect(alpha.id).toMatch(/^session:\$[0-9]+$/);
    // orcs sorted by paneIndex within the window: %21 (p0) before %20 (p1)
    expect(alpha.orcs.map((o) => o.paneId)).toEqual(['%21', '%20']);
    expect(alpha.orcs[0]!.id).toBe('pane:%21');
  });
});

describe('aggregation (SPEC-005-AC-12)', () => {
  it('orcCount/paneCount/statusSummary roll up consistently', async () => {
    const inv = inventory(
      [{ sessionId: '$1', sessionName: 'work', windows: 1, attached: true, activityAt: SCANNED_AT }],
      [
        rec({ paneId: '%10', sessionName: 'work', windowIndex: 1, paneIndex: 0, command: 'claude' }),
        rec({ paneId: '%11', sessionName: 'work', windowIndex: 1, paneIndex: 1, command: 'codex' }),
        rec({ paneId: '%12', sessionName: 'work', windowIndex: 1, paneIndex: 2, command: 'zsh' }), // non-candidate
      ],
    );
    const { result } = await assemble(inv);
    const camp = result.camps[0]!;
    expect(camp.orcCount).toBe(camp.orcs.length);
    expect(camp.orcCount).toBe(2);
    expect(camp.paneCount).toBe(3); // includes the shell
    expect(camp.paneCount).toBeGreaterThanOrEqual(camp.orcCount);
    const campSum = Object.values(camp.statusSummary).reduce((a, b) => a + b, 0);
    expect(campSum).toBe(camp.orcCount);
    const topSum = Object.values(result.statusSummary).reduce((a, b) => a + b, 0);
    expect(topSum).toBe(camp.orcCount);
  });

  it('a session with no detected agents yields a camp with orcCount 0 (no-agent state)', async () => {
    const inv = inventory(
      [{ sessionId: '$1', sessionName: 'work', windows: 1, attached: true, activityAt: SCANNED_AT }],
      [rec({ paneId: '%10', sessionName: 'work', windowIndex: 1, paneIndex: 0, command: 'zsh' })],
    );
    const { result } = await assemble(inv);
    expect(result.camps).toHaveLength(1);
    expect(result.camps[0]!.orcCount).toBe(0);
  });
});

describe('preview metadata (SPEC-005-AC-10, §2.7)', () => {
  it('long capture truncates to PREVIEW_LINES; short does not; failed capture → null', async () => {
    const longRaw = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const inv = inventory(
      [{ sessionId: '$1', sessionName: 'work', windows: 1, attached: true, activityAt: SCANNED_AT }],
      [
        rec({ paneId: '%10', sessionName: 'work', windowIndex: 1, paneIndex: 0, command: 'claude', capture: cap(longRaw) }),
        rec({ paneId: '%11', sessionName: 'work', windowIndex: 1, paneIndex: 1, command: 'codex', capture: cap('a\nb') }),
        rec({ paneId: '%12', sessionName: 'work', windowIndex: 1, paneIndex: 2, command: 'claude', capture: null }),
      ],
    );
    const { result } = await assemble(inv);
    const orcs = Object.fromEntries(result.camps[0]!.orcs.map((o) => [o.paneId, o]));
    expect(orcs['%10']!.preview).toEqual({ lines: 12, truncated: true, redacted: false });
    expect(orcs['%11']!.preview).toEqual({ lines: 2, truncated: false, redacted: false });
    expect(orcs['%12']!.preview).toBeNull();
  });

  it('a capture containing a placeholder secret sets redacted=true and never leaks the literal', async () => {
    const secret = 'ghp_BBBBBBBBBBBBBBBBBBBB9999';
    const inv = inventory(
      [{ sessionId: '$1', sessionName: 'work', windows: 1, attached: true, activityAt: SCANNED_AT }],
      [rec({ paneId: '%10', sessionName: 'work', windowIndex: 1, paneIndex: 0, command: 'claude', capture: cap(`push ${secret}`) })],
    );
    const { result } = await assemble(inv);
    const orc = result.camps[0]!.orcs[0]!;
    expect(orc.preview?.redacted).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe('agent uptime axis (SPEC-302 §3.7 / D-040)', () => {
  const node = (p: Partial<ProcessNode> & Pick<ProcessNode, 'pid' | 'depth' | 'command'>): ProcessNode => ({
    ppid: 1,
    ...p,
  });

  async function orcOf(p: Partial<PaneRawRecord> & Pick<PaneRawRecord, 'paneId' | 'command'>) {
    const inv = inventory(
      [{ sessionId: '$1', sessionName: 'work', windows: 1, attached: true, activityAt: SCANNED_AT }],
      [rec({ sessionName: 'work', windowIndex: 1, paneIndex: 0, ...p })],
    );
    const { result } = await assemble(inv);
    return result.camps[0]!.orcs[0]!;
  }

  it('sets uptimeSec to the LONGEST-LIVED matching agent-runtime node and serializes it', async () => {
    const orc = await orcOf({
      paneId: '%10',
      command: 'node', // wrapper foreground; subtree carries the agent argv
      processTree: [
        node({ pid: 1000, depth: 0, command: '-zsh', etimeSec: 9000 }), // not an agent node
        node({ pid: 1001, ppid: 1000, depth: 1, command: 'claude', etimeSec: 3600 }),
        node({ pid: 1002, ppid: 1001, depth: 2, command: 'node /usr/lib/@anthropic-ai/claude-code/cli.js', etimeSec: 4200 }),
      ],
    });
    expect(orc.agentType).toBe('claude-code');
    // longest-lived AGENT node = the @anthropic-ai/claude-code wrapper (4200), NOT the 9000 shell.
    expect(orc.uptimeSec).toBe(4200);
    // flows to the serialized wire Orc
    const round = JSON.parse(JSON.stringify(orc)) as { uptimeSec: number | null };
    expect(round.uptimeSec).toBe(4200);
  });

  it('selects the codex runtime node for a codex orc', async () => {
    const orc = await orcOf({
      paneId: '%11',
      command: 'codex',
      processTree: [node({ pid: 2000, depth: 0, command: 'codex', etimeSec: 1800 })],
    });
    expect(orc.agentType).toBe('codex');
    expect(orc.uptimeSec).toBe(1800);
  });

  it('uptimeSec is null when introspection is unavailable (no processTree)', async () => {
    const orc = await orcOf({ paneId: '%12', command: 'claude' }); // rec() leaves processTree absent
    expect(orc.agentType).toBe('claude-code');
    expect(orc.uptimeSec).toBeNull();
  });

  it('uptimeSec is null when the subtree has no live agent-runtime node', async () => {
    const orc = await orcOf({
      paneId: '%13',
      command: 'claude', // G-CMD still makes this a candidate
      processTree: [node({ pid: 3000, depth: 0, command: '-zsh', etimeSec: 5000 })], // no claude/codex node
    });
    expect(orc.agentType).toBe('claude-code');
    expect(orc.uptimeSec).toBeNull();
  });

  it('uptimeSec is null for a terminated (paneDead) orc even if a matching node lingers', async () => {
    const orc = await orcOf({
      paneId: '%14',
      command: 'claude',
      paneDead: true,
      capture: null,
      processTree: [node({ pid: 4000, depth: 0, command: 'claude', etimeSec: 7200 })],
    });
    expect(orc.status).toBe('terminated');
    expect(orc.uptimeSec).toBeNull();
  });

  it('ignores nodes with a missing/garbled etimeSec', async () => {
    const orc = await orcOf({
      paneId: '%15',
      command: 'claude',
      processTree: [
        node({ pid: 5000, depth: 0, command: 'claude' }), // no etimeSec → skipped
        node({ pid: 5001, ppid: 5000, depth: 1, command: 'claude wrapper', etimeSec: 600 }),
      ],
    });
    expect(orc.uptimeSec).toBe(600);
  });
});
