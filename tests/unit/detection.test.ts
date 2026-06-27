/**
 * SPEC-003 — agent-detection unit tests (TC-U-DET-*).
 * Covers SPEC-003-AC-01..09. Deterministic, no live tmux; placeholder text only.
 */
import { describe, expect, it } from 'vitest';
import type { AgentDetector, OrcCandidate, PaneSignal } from '../../src/types';
import { AGENT_BAND } from '../../src/types';
import { claudeCode } from '../../src/detection/adapters/claude-code';
import { codex } from '../../src/detection/adapters/codex';
import { basename, defaultDetectors, detectOrc } from '../../src/detection/detect';

// --- fixtures ---------------------------------------------------------------

function makePane(overrides: Partial<PaneSignal> = {}): PaneSignal {
  return {
    paneId: '%1',
    tmuxTarget: 'work:1.0',
    command: 'zsh',
    paneTitle: null,
    cmdline: null,
    cwd: '/home/user/project',
    recentOutput: [],
    ...overrides,
  };
}

const isLow = (c: number) => c < AGENT_BAND.lowMax;
const isMedium = (c: number) => c >= AGENT_BAND.lowMax && c < AGENT_BAND.mediumMax;
const isHigh = (c: number) => c >= AGENT_BAND.mediumMax;

// --- AC-01 — direct command claude / claude-code (Tier A) -------------------

describe('SPEC-003-AC-01 direct command → claude-code (Tier A)', () => {
  it('classifies basename "claude" as claude-code HIGH with a Tier A signal', () => {
    const r = detectOrc(makePane({ command: 'claude' }), defaultDetectors);
    expect(r).not.toBeNull();
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(c.agentTypeConfidence).toBeGreaterThanOrEqual(0.85);
    expect(isHigh(c.agentTypeConfidence)).toBe(true);
    expect(c.matchedSignals.some((s) => s.tier === 'A')).toBe(true);
  });

  it('classifies "claude-code" and full-path commands via basename', () => {
    const r1 = detectOrc(makePane({ command: 'claude-code' }), defaultDetectors);
    const r2 = detectOrc(makePane({ command: '/usr/local/bin/claude' }), defaultDetectors);
    expect(r1?.agentType).toBe('claude-code');
    expect(r2?.agentType).toBe('claude-code');
    expect(r2?.agentTypeConfidence).toBeGreaterThanOrEqual(0.85);
  });
});

// --- AC-02 — direct command codex (Tier A) ----------------------------------

describe('SPEC-003-AC-02 direct command → codex (Tier A)', () => {
  it('classifies basename "codex" as codex HIGH with a Tier A signal', () => {
    const r = detectOrc(makePane({ command: 'codex' }), defaultDetectors);
    expect(r).not.toBeNull();
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('codex');
    expect(c.agentTypeConfidence).toBeGreaterThanOrEqual(0.85);
    expect(c.matchedSignals.some((s) => s.tier === 'A')).toBe(true);
  });
});

// --- AC-03 — wrapper + signature (Tier B, MEDIUM) ---------------------------

describe('SPEC-003-AC-03 generic runtime + signature → claude-code (Tier B)', () => {
  it('detects node + cmdline signature as MEDIUM Tier B', () => {
    const r = detectOrc(
      makePane({ command: 'node', cmdline: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js' }),
      defaultDetectors,
    );
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(isMedium(c.agentTypeConfidence)).toBe(true);
    expect(c.matchedSignals.some((s) => s.tier === 'B')).toBe(true);
  });

  it('falls back to paneTitle signature when cmdline is unavailable', () => {
    const r = detectOrc(
      makePane({ command: 'node', cmdline: null, paneTitle: 'claude-code — refactor' }),
      defaultDetectors,
    );
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(isMedium(c.agentTypeConfidence)).toBe(true);
    expect(c.matchedSignals.some((s) => s.tier === 'B')).toBe(true);
  });
});

// --- AC-04 — ambiguous candidate → unknown LOW (not null) -------------------

describe('SPEC-003-AC-04 ambiguous candidate → unknown LOW', () => {
  it('returns an unknown LOW candidate for a generic-runtime agent marker', () => {
    const r = detectOrc(
      makePane({
        command: 'node',
        paneTitle: 'my assistant runner',
        recentOutput: ['booting service', 'ready on stream'],
      }),
      defaultDetectors,
    );
    expect(r).not.toBeNull();
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('unknown');
    expect(isLow(c.agentTypeConfidence)).toBe(true);
    expect(c.matchedSignals.length).toBeGreaterThanOrEqual(1);
  });
});

// --- AC-05 — non-candidate → null -------------------------------------------

describe('SPEC-003-AC-05 shell / non-agent → null', () => {
  it('returns null for a plain shell with no signals', () => {
    expect(detectOrc(makePane({ command: 'zsh' }), defaultDetectors)).toBeNull();
  });

  it('returns null for a plain node web server (no AI marker)', () => {
    const r = detectOrc(
      makePane({ command: 'node', cmdline: 'node server.js', recentOutput: ['listening on :3000'] }),
      defaultDetectors,
    );
    expect(r).toBeNull();
  });
});

// --- AC-06 — output-only cap ------------------------------------------------

describe('SPEC-003-AC-06 output banner only → concrete type, cap ≤ 0.60', () => {
  it('detects claude-code via output banner but caps confidence', () => {
    const r = detectOrc(
      makePane({ command: 'node', recentOutput: ['', 'Welcome to Claude Code', 'thinking...'] }),
      defaultDetectors,
    );
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(c.agentTypeConfidence).toBeLessThanOrEqual(0.6);
    expect(isHigh(c.agentTypeConfidence)).toBe(false);
    expect(c.matchedSignals.every((s) => s.tier === 'C')).toBe(true);
  });
});

// --- AC-07 — open for extension ---------------------------------------------

describe('SPEC-003-AC-07 new adapter extends detection without edits', () => {
  it('resolves a new adapter id added only to the detectors list', () => {
    const geminiId = 'gemini-cli' as unknown as AgentDetector['id'];
    const gemini: AgentDetector = {
      id: geminiId,
      detect(pane) {
        if (pane.paneTitle === 'gemini') {
          return {
            agentType: geminiId,
            agentTypeConfidence: 0.95,
            matchedSignals: [
              { signal: 'title', tier: 'A', matchedType: geminiId, ruleId: 'gemini-cli/title' },
            ],
          };
        }
        return null;
      },
    };
    const r = detectOrc(makePane({ command: 'node', paneTitle: 'gemini' }), [
      ...defaultDetectors,
      gemini,
    ]);
    expect(r?.agentType).toBe(geminiId);
  });
});

// --- AC-08 — equal-tier conflict → unknown LOW ------------------------------

describe('SPEC-003-AC-08 equal-tier conflict → unknown LOW', () => {
  it('does not assert a concrete type when two adapters tie on tier', () => {
    const r = detectOrc(
      makePane({
        command: 'node',
        recentOutput: ['Welcome to Claude Code', 'OpenAI Codex session started'],
      }),
      defaultDetectors,
    );
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('unknown');
    expect(isLow(c.agentTypeConfidence)).toBe(true);
    const types = new Set(c.matchedSignals.map((s) => s.matchedType));
    expect(types.has('claude-code')).toBe(true);
    expect(types.has('codex')).toBe(true);
  });

  it('picks the unique strongest tier but caps to MEDIUM on conflict', () => {
    const r = detectOrc(
      makePane({ command: 'claude', recentOutput: ['OpenAI Codex session started'] }),
      defaultDetectors,
    );
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(isMedium(c.agentTypeConfidence)).toBe(true);
    expect(c.matchedSignals.some((s) => s.matchedType === 'codex')).toBe(true);
  });
});

// --- AC-09 — corroboration monotonicity -------------------------------------

describe('SPEC-003-AC-09 same-type Tier A + Tier C corroboration', () => {
  it('keeps confidence ≥ single Tier A base and records both signals', () => {
    const r = detectOrc(
      makePane({ command: 'claude', recentOutput: ['✻ Welcome to Claude Code'] }),
      defaultDetectors,
    );
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(c.agentTypeConfidence).toBeGreaterThanOrEqual(0.95);
    const signals = new Set(c.matchedSignals.map((s) => s.signal));
    expect(signals.has('command')).toBe(true);
    expect(signals.has('output')).toBe(true);
  });
});

// --- determinism & provenance safety ----------------------------------------

describe('detection determinism + redaction-safe provenance', () => {
  it('is deterministic across repeated calls', () => {
    const pane = makePane({ command: 'node', cmdline: 'node cli.js @anthropic-ai/claude-code' });
    expect(detectOrc(pane, defaultDetectors)).toEqual(detectOrc(pane, defaultDetectors));
  });

  it('basename strips directories and lowercases', () => {
    expect(basename('/usr/local/bin/claude')).toBe('claude');
    expect(basename('CLAUDE')).toBe('claude');
  });

  it('claude adapter detect() returns a self-consistent candidate', () => {
    const c = claudeCode.detect(makePane({ command: 'claude' }));
    expect(c?.agentType).toBe('claude-code');
    expect(codex.detect(makePane({ command: 'claude' }))).toBeNull();
  });
});
