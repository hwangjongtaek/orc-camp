/**
 * SPEC-004 — status-inference unit tests (TC-U-STAT-*).
 * Covers SPEC-004-AC-01..13 and AC-15 (determinism). Deterministic: all clocks
 * are injected ISO strings, no real time. Placeholder text only.
 */
import { describe, expect, it } from 'vitest';
import type { OrcCandidate, PaneSignal, PriorOrcState, StatusInput } from '../../src/types';
import { STATUS_BAND } from '../../src/types';
import { computeFingerprint, normalizeLine } from '../../src/status/fingerprint';
import { inferStatus } from '../../src/status/infer';

// --- clocks -----------------------------------------------------------------
const SCANNED_AT = '2026-06-26T12:00:00.000Z';
const ACT_RECENT = '2026-06-26T11:59:59.000Z'; // 1s  → recent (≤ T_active 5s)
const ACT_MID = '2026-06-26T11:59:40.000Z'; // 20s → between active & idle
const ACT_IDLE = '2026-06-26T11:59:00.000Z'; // 60s → past T_idle 30s

// --- fixture builders -------------------------------------------------------

type Lifecycle = StatusInput['lifecycle'];

interface InputOverrides {
  candidate?: OrcCandidate;
  pane?: Partial<PaneSignal>;
  lifecycle?: Partial<Lifecycle>;
  scannedAt?: string;
  snapshotStale?: boolean;
  captureUnavailable?: boolean;
  prior?: PriorOrcState | null;
  userLabel?: string | null;
}

function makeCandidate(overrides: Partial<OrcCandidate> = {}): OrcCandidate {
  return {
    agentType: 'claude-code',
    agentTypeConfidence: 0.95,
    matchedSignals: [
      { signal: 'command', tier: 'A', matchedType: 'claude-code', ruleId: 'claude-code/cmd.basename' },
    ],
    ...overrides,
  };
}

function makeInput(overrides: InputOverrides = {}): StatusInput {
  const pane: PaneSignal = {
    paneId: '%1',
    tmuxTarget: 'work:1.0',
    command: 'claude',
    paneTitle: null,
    cmdline: null,
    cwd: '/home/user/project',
    recentOutput: [],
    ...overrides.pane,
  };
  const lifecycle: Lifecycle = {
    paneId: '%1',
    paneDead: false,
    panePid: 4242,
    processAlive: true,
    lastActivityAt: ACT_MID,
    ...overrides.lifecycle,
  };
  return {
    candidate: overrides.candidate ?? makeCandidate(),
    pane,
    lifecycle,
    scannedAt: overrides.scannedAt ?? SCANNED_AT,
    snapshotStale: overrides.snapshotStale ?? false,
    captureUnavailable: overrides.captureUnavailable ?? false,
    prior: overrides.prior ?? null,
    userLabel: overrides.userLabel ?? null,
  };
}

function priorFor(lines: string[]): PriorOrcState {
  return {
    paneId: '%1',
    captureFingerprint: computeFingerprint(lines),
    status: 'active',
    lastActivityAt: ACT_RECENT,
    observedAt: '2026-06-26T11:59:57.000Z',
  };
}

const isLow = (c: number) => c < STATUS_BAND.lowMax;
const isMedium = (c: number) => c >= STATUS_BAND.lowMax && c < STATUS_BAND.mediumMax;
const isHigh = (c: number) => c >= STATUS_BAND.mediumMax;

// --- AC-01 — output shape ---------------------------------------------------

describe('SPEC-004-AC-01 output shape', () => {
  it('always returns the six inference fields', () => {
    const r = inferStatus(makeInput());
    expect(typeof r.status).toBe('string');
    expect(r.statusConfidence).toBeGreaterThanOrEqual(0);
    expect(r.statusConfidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(r.statusSignals)).toBe(true);
    expect(r).toHaveProperty('currentWorkSummary');
    expect(r).toHaveProperty('summarySource');
    expect(typeof r.summaryIsEstimated).toBe('boolean');
  });
});

// --- AC-02 — no signals → unknown LOW ---------------------------------------

describe('SPEC-004-AC-02 no signals → unknown LOW', () => {
  it('returns unknown LOW when capture empty, no prior, no other signal', () => {
    const r = inferStatus(makeInput({ pane: { recentOutput: [] }, lifecycle: { lastActivityAt: ACT_MID } }));
    expect(r.status).toBe('unknown');
    expect(r.statusConfidence).toBeLessThanOrEqual(0.49);
    expect(isLow(r.statusConfidence)).toBe(true);
  });
});

// --- AC-03 — meaningful change → active HIGH --------------------------------

describe('SPEC-004-AC-03 non-volatile change → active HIGH', () => {
  it('detects active with a change signal at HIGH confidence', () => {
    const prior = priorFor(['line A', 'line B']);
    const r = inferStatus(
      makeInput({
        pane: { recentOutput: ['line A', 'line B', 'Editing src/foo.ts now'] },
        lifecycle: { lastActivityAt: ACT_RECENT },
        prior,
      }),
    );
    expect(r.status).toBe('active');
    expect(r.statusConfidence).toBeGreaterThanOrEqual(0.8);
    expect(isHigh(r.statusConfidence)).toBe(true);
    expect(r.statusSignals.some((s) => s.signal === 'change')).toBe(true);
  });
});

// --- AC-04 — volatile-only change → not active HIGH -------------------------

describe('SPEC-004-AC-04 volatile-only change → not active HIGH', () => {
  it('does not assert HIGH active when only spinner/clock changed', () => {
    const priorLines = ['Building project', '⠋ Working 3s 45%'];
    const currentLines = ['Building project', '⠙ Working 7s 80%'];
    // sanity: normalization collapses the volatile difference.
    expect(normalizeLine(priorLines[1]!)).toBe(normalizeLine(currentLines[1]!));

    const r = inferStatus(
      makeInput({
        pane: { recentOutput: currentLines },
        lifecycle: { lastActivityAt: ACT_RECENT },
        prior: priorFor(priorLines),
      }),
    );
    const notHighActive = r.status !== 'active' || r.statusConfidence <= 0.49;
    expect(notHighActive).toBe(true);
  });
});

// --- AC-05 — waiting (adapter HIGH / generic MEDIUM) ------------------------

describe('SPEC-004-AC-05 tail prompt static → waiting', () => {
  it('adapter-specific prompt → HIGH', () => {
    const lines = ['Editing files', 'Do you want to proceed?'];
    const r = inferStatus(
      makeInput({
        candidate: makeCandidate({ agentType: 'claude-code' }),
        pane: { recentOutput: lines },
        prior: priorFor(lines),
      }),
    );
    expect(r.status).toBe('waiting');
    expect(r.statusConfidence).toBeGreaterThanOrEqual(0.8);
  });

  it('generic prompt → MEDIUM (≥ 0.50)', () => {
    const lines = ['running task', 'Continue? (y/n)'];
    const r = inferStatus(
      makeInput({
        candidate: makeCandidate({ agentType: 'codex' }),
        pane: { command: 'codex', recentOutput: lines },
        prior: priorFor(lines),
      }),
    );
    expect(r.status).toBe('waiting');
    expect(r.statusConfidence).toBeGreaterThanOrEqual(0.5);
    expect(isMedium(r.statusConfidence)).toBe(true);
  });
});

// --- AC-06 — waiting false-positive suppression -----------------------------

describe('SPEC-004-AC-06 mid-stream prompt + streaming tail → not waiting', () => {
  it('does not flag waiting when (y/n) is mid-stream and tail is changing', () => {
    const prior = priorFor(['old log 1', 'old log 2']);
    const r = inferStatus(
      makeInput({
        pane: {
          recentOutput: [
            'Confirm action (y/n)',
            'user accepted',
            'Generating response now',
            'Streaming token output here',
          ],
        },
        lifecycle: { lastActivityAt: ACT_RECENT },
        prior,
      }),
    );
    expect(r.status).not.toBe('waiting');
    expect(r.status).toBe('active');
  });
});

// --- AC-07 — idle -----------------------------------------------------------

describe('SPEC-004-AC-07 inactivity past T_idle → idle', () => {
  it('returns idle with no other signal', () => {
    const r = inferStatus(
      makeInput({
        pane: { recentOutput: ['waiting for next task'] },
        lifecycle: { lastActivityAt: ACT_IDLE },
        prior: null,
      }),
    );
    expect(r.status).toBe('idle');
  });
});

// --- AC-08 — error (traceback HIGH vs keyword MEDIUM) -----------------------

describe('SPEC-004-AC-08 error confidence by evidence', () => {
  it('multi-line traceback → HIGH', () => {
    const r = inferStatus(
      makeInput({
        pane: {
          recentOutput: [
            'Running script',
            'Traceback (most recent call last)',
            '  File "app.py", line 42, in <module>',
            '    main()',
            '  File "app.py", line 10, in main',
            '    raise ValueError("bad input")',
            'ValueError: bad input',
          ],
        },
      }),
    );
    expect(r.status).toBe('error');
    expect(r.statusConfidence).toBeGreaterThanOrEqual(0.8);
  });

  it('single error keyword → MEDIUM (≤ 0.60)', () => {
    const r = inferStatus(
      makeInput({ pane: { recentOutput: ['compiling module', 'Error: connection refused'] } }),
    );
    expect(r.status).toBe('error');
    expect(r.statusConfidence).toBeLessThanOrEqual(0.6);
  });
});

// --- AC-09 — terminated (pane_dead) + retention -----------------------------

describe('SPEC-004-AC-09 pane_dead → terminated HIGH', () => {
  it('returns terminated at HIGH and is not removed by inference', () => {
    const r = inferStatus(makeInput({ lifecycle: { paneDead: true, lastActivityAt: ACT_IDLE } }));
    expect(r.status).toBe('terminated');
    expect(r.statusConfidence).toBeGreaterThanOrEqual(0.8);
  });
});

// --- AC-10 — stale vs terminated --------------------------------------------

describe('SPEC-004-AC-10 snapshotStale → stale (≠ terminated)', () => {
  it('returns stale when data is a last-good fallback and pane is alive', () => {
    const r = inferStatus(
      makeInput({ snapshotStale: true, lifecycle: { paneDead: false, lastActivityAt: ACT_IDLE } }),
    );
    expect(r.status).toBe('stale');
    expect(r.status).not.toBe('terminated');
  });

  it('stale precedence holds even if pane_dead is set on non-fresh data', () => {
    const r = inferStatus(makeInput({ snapshotStale: true, lifecycle: { paneDead: true } }));
    expect(r.status).toBe('stale');
  });
});

// --- AC-11 — summarySource priority -----------------------------------------

describe('SPEC-004-AC-11 summarySource priority', () => {
  it('user_label wins', () => {
    const r = inferStatus(makeInput({ userLabel: 'Refactor auth module' }));
    expect(r.summarySource).toBe('user_label');
  });

  it('recent_prompt when waiting and no label', () => {
    const lines = ['Editing files', 'Do you want to proceed?'];
    const r = inferStatus(makeInput({ pane: { recentOutput: lines }, prior: priorFor(lines) }));
    expect(r.status).toBe('waiting');
    expect(r.summarySource).toBe('recent_prompt');
  });

  it('pane_title when descriptive, not waiting, no label', () => {
    const r = inferStatus(
      makeInput({
        pane: { paneTitle: 'Building the dashboard', recentOutput: ['some build log line'] },
        lifecycle: { lastActivityAt: ACT_IDLE },
      }),
    );
    expect(r.summarySource).toBe('pane_title');
  });

  it('recent_output when only output is available', () => {
    const r = inferStatus(
      makeInput({
        pane: { paneTitle: null, recentOutput: ['compiling module five'] },
        lifecycle: { lastActivityAt: ACT_IDLE },
      }),
    );
    expect(r.summarySource).toBe('recent_output');
  });

  it('unknown when nothing usable', () => {
    const r = inferStatus(
      makeInput({ pane: { paneTitle: null, recentOutput: [] }, lifecycle: { lastActivityAt: ACT_IDLE } }),
    );
    expect(r.summarySource).toBe('unknown');
    expect(r.currentWorkSummary).toBeNull();
  });
});

// --- AC-12 — summaryIsEstimated ---------------------------------------------

describe('SPEC-004-AC-12 summaryIsEstimated', () => {
  it('user_label → false; auto source → true', () => {
    const labeled = inferStatus(makeInput({ userLabel: 'My task' }));
    expect(labeled.summaryIsEstimated).toBe(false);

    const titled = inferStatus(
      makeInput({
        pane: { paneTitle: 'Building the dashboard', recentOutput: [] },
        lifecycle: { lastActivityAt: ACT_IDLE },
      }),
    );
    expect(titled.summaryIsEstimated).toBe(true);
    expect(titled.statusConfidence).toBeGreaterThanOrEqual(0);
  });
});

// --- AC-13 — redaction privacy boundary -------------------------------------

describe('SPEC-004-AC-13 all-redacted summary candidates are skipped', () => {
  it('skips fully-redacted lines and never leaks raw text in provenance', () => {
    const r = inferStatus(
      makeInput({
        pane: { paneTitle: null, recentOutput: ['[REDACTED:aws_secret_key]'] },
        lifecycle: { lastActivityAt: ACT_IDLE },
      }),
    );
    expect(r.summarySource).toBe('unknown');
    expect(r.currentWorkSummary).toBeNull();
    const serialized = JSON.stringify(r.statusSignals);
    expect(serialized).not.toContain('REDACTED');
    expect(serialized).not.toContain('aws_secret_key');
    for (const s of r.statusSignals) {
      expect(Object.keys(s).sort()).toEqual(['ruleId', 'signal', 'status', 'strength']);
    }
  });
});

// --- AC-15 — determinism ----------------------------------------------------

describe('SPEC-004-AC-15 determinism', () => {
  it('produces identical output for identical input across two runs', () => {
    const lines = ['line A', 'line B', 'Editing src/foo.ts now'];
    const build = () =>
      makeInput({
        pane: { recentOutput: lines },
        lifecycle: { lastActivityAt: ACT_RECENT },
        prior: priorFor(['line A', 'line B']),
      });
    expect(inferStatus(build())).toEqual(inferStatus(build()));
  });
});

// --- structural band ordering (AC-14 is a measurement task; structural only) -

describe('confidence bands are structurally ordered', () => {
  it('terminated(HIGH) > idle(MEDIUM) > unknown(LOW)', () => {
    const term = inferStatus(makeInput({ lifecycle: { paneDead: true } })).statusConfidence;
    const idle = inferStatus(
      makeInput({ pane: { recentOutput: ['idle'] }, lifecycle: { lastActivityAt: ACT_IDLE } }),
    ).statusConfidence;
    const unknown = inferStatus(
      makeInput({ pane: { recentOutput: [] }, lifecycle: { lastActivityAt: ACT_MID } }),
    ).statusConfidence;
    expect(term).toBeGreaterThan(idle);
    expect(idle).toBeGreaterThan(unknown);
  });
});

// ===========================================================================
// SPEC-004 §3.1-2b / §3.8 — liveness-gate (agentProcessAlive) + agent-gone S-AGONE
// ===========================================================================

// --- TC-U-STAT-LIVEGATE (AC-16/18/19) ---------------------------------------

describe('TC-U-STAT-LIVEGATE (SPEC-004-AC-16/18/19) — active requires a live agent', () => {
  it('AC-19: agentProcessAlive=true + non-volatile change → active HIGH (gate does not block)', () => {
    const r = inferStatus(
      makeInput({
        pane: { recentOutput: ['line A', 'line B', 'Editing src/foo.ts now'] },
        lifecycle: { lastActivityAt: ACT_RECENT, agentProcessAlive: true },
        prior: priorFor(['line A', 'line B']),
      }),
    );
    expect(r.status).toBe('active');
    expect(r.statusConfidence).toBeGreaterThanOrEqual(0.8);
  });

  it('AC-16: agentProcessAlive=false + change/recent stale scrollback → NOT active', () => {
    const r = inferStatus(
      makeInput({
        pane: { recentOutput: ['line A', 'line B', 'Editing src/foo.ts now'] },
        lifecycle: { lastActivityAt: ACT_RECENT, agentProcessAlive: false },
        prior: priorFor(['line A', 'line B']),
      }),
    );
    expect(r.status).not.toBe('active');
    expect(r.status).toBe('terminated'); // agent-gone (S-AGONE) precedes the tail ladder
  });

  it('AC-18: agentProcessAlive=null (subtree unavailable) → active but NOT HIGH (degrade)', () => {
    const r = inferStatus(
      makeInput({
        pane: { recentOutput: ['line A', 'line B', 'Editing src/foo.ts now'] },
        lifecycle: { lastActivityAt: ACT_RECENT, agentProcessAlive: null },
        prior: priorFor(['line A', 'line B']),
      }),
    );
    expect(r.status).toBe('active');
    expect(r.statusConfidence).toBeLessThan(0.8); // cannot prove liveness → not HIGH
    expect(isMedium(r.statusConfidence)).toBe(true);
  });

  it('undefined agentProcessAlive (legacy/no-info) leaves the gate inert (AC-03 unchanged)', () => {
    const r = inferStatus(
      makeInput({
        pane: { recentOutput: ['line A', 'line B', 'Editing src/foo.ts now'] },
        lifecycle: { lastActivityAt: ACT_RECENT }, // no agentProcessAlive
        prior: priorFor(['line A', 'line B']),
      }),
    );
    expect(r.status).toBe('active');
    expect(r.statusConfidence).toBeGreaterThanOrEqual(0.8);
  });
});

// --- TC-U-STAT-AGONE (AC-17/20) ---------------------------------------------

describe('TC-U-STAT-AGONE (SPEC-004-AC-17/20) — live shell, dead agent → terminated', () => {
  it('AC-17: agentProcessAlive=false (shell alive, no agent) → terminated, distinct from stale', () => {
    const r = inferStatus(
      makeInput({
        pane: { paneTitle: '✳ Claude Code', recentOutput: ['$ '] },
        lifecycle: { paneDead: false, processAlive: true, agentProcessAlive: false },
      }),
    );
    expect(r.status).toBe('terminated');
    expect(isMedium(r.statusConfidence)).toBe(true); // S-AGONE MEDIUM (~0.65), not HIGH
    expect(r.statusSignals.some((s) => s.ruleId === 'terminated/agent_gone')).toBe(true);
  });

  it('AC-20: dead-session scrollback error is NOT reported as live error (gate precedes tail)', () => {
    const r = inferStatus(
      makeInput({
        pane: { recentOutput: ['compiling', 'Error: connection refused'] },
        lifecycle: { agentProcessAlive: false },
      }),
    );
    expect(r.status).toBe('terminated');
    expect(r.status).not.toBe('error');
  });

  it('AC-20: dead-session scrollback (y/n) prompt is NOT reported as live waiting', () => {
    const r = inferStatus(
      makeInput({
        pane: { recentOutput: ['Continue? (y/n)'] },
        lifecycle: { agentProcessAlive: false },
      }),
    );
    expect(r.status).toBe('terminated');
    expect(r.status).not.toBe('waiting');
  });
});
