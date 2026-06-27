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
  it('sorts camps by name and orcs by window→pane; derives stable ids', () => {
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
    const { result } = assemble(inv);
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
  it('orcCount/paneCount/statusSummary roll up consistently', () => {
    const inv = inventory(
      [{ sessionId: '$1', sessionName: 'work', windows: 1, attached: true, activityAt: SCANNED_AT }],
      [
        rec({ paneId: '%10', sessionName: 'work', windowIndex: 1, paneIndex: 0, command: 'claude' }),
        rec({ paneId: '%11', sessionName: 'work', windowIndex: 1, paneIndex: 1, command: 'codex' }),
        rec({ paneId: '%12', sessionName: 'work', windowIndex: 1, paneIndex: 2, command: 'zsh' }), // non-candidate
      ],
    );
    const { result } = assemble(inv);
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

  it('a session with no detected agents yields a camp with orcCount 0 (no-agent state)', () => {
    const inv = inventory(
      [{ sessionId: '$1', sessionName: 'work', windows: 1, attached: true, activityAt: SCANNED_AT }],
      [rec({ paneId: '%10', sessionName: 'work', windowIndex: 1, paneIndex: 0, command: 'zsh' })],
    );
    const { result } = assemble(inv);
    expect(result.camps).toHaveLength(1);
    expect(result.camps[0]!.orcCount).toBe(0);
  });
});

describe('preview metadata (SPEC-005-AC-10, §2.7)', () => {
  it('long capture truncates to PREVIEW_LINES; short does not; failed capture → null', () => {
    const longRaw = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const inv = inventory(
      [{ sessionId: '$1', sessionName: 'work', windows: 1, attached: true, activityAt: SCANNED_AT }],
      [
        rec({ paneId: '%10', sessionName: 'work', windowIndex: 1, paneIndex: 0, command: 'claude', capture: cap(longRaw) }),
        rec({ paneId: '%11', sessionName: 'work', windowIndex: 1, paneIndex: 1, command: 'codex', capture: cap('a\nb') }),
        rec({ paneId: '%12', sessionName: 'work', windowIndex: 1, paneIndex: 2, command: 'claude', capture: null }),
      ],
    );
    const { result } = assemble(inv);
    const orcs = Object.fromEntries(result.camps[0]!.orcs.map((o) => [o.paneId, o]));
    expect(orcs['%10']!.preview).toEqual({ lines: 12, truncated: true, redacted: false });
    expect(orcs['%11']!.preview).toEqual({ lines: 2, truncated: false, redacted: false });
    expect(orcs['%12']!.preview).toBeNull();
  });

  it('a capture containing a placeholder secret sets redacted=true and never leaks the literal', () => {
    const secret = 'ghp_BBBBBBBBBBBBBBBBBBBB9999';
    const inv = inventory(
      [{ sessionId: '$1', sessionName: 'work', windows: 1, attached: true, activityAt: SCANNED_AT }],
      [rec({ paneId: '%10', sessionName: 'work', windowIndex: 1, paneIndex: 0, command: 'claude', capture: cap(`push ${secret}`) })],
    );
    const { result } = assemble(inv);
    const orc = result.camps[0]!.orcs[0]!;
    expect(orc.preview?.redacted).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
