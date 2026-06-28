/**
 * SPEC-003 — agent-detection unit tests (TC-U-DET-*).
 * Covers SPEC-003-AC-01..09. Deterministic, no live tmux; placeholder text only.
 */
import { describe, expect, it } from 'vitest';
import type { AgentDetector, OrcCandidate, PaneSignal, ProcessNode } from '../../src/types';
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

// --- Calibration regression (2026-06-27) — bare-word output banner FP --------
// SPEC-003 §6: live M1 measurement on a real 101-pane environment showed the
// Tier-C OUTPUT banner false-firing on non-agent panes (nvim/zsh) whose captured
// content merely MENTIONS the bare word "codex"/"claude" (this repo is about orcs
// /codex, so editor/shell panes showing these files tripped it). The output path
// now requires a DISTINCTIVE product marker; a bare word alone must NOT detect.

describe('SPEC-003 calibration — bare-word output banner no longer detects', () => {
  it('bare "codex" in output with a non-agent command (nvim) → null', () => {
    const r = detectOrc(
      makePane({ command: 'nvim', recentOutput: ['editing docs', 'the codex spec mentions orcs'] }),
      defaultDetectors,
    );
    expect(r).toBeNull();
  });

  it('bare "claude" in output with a non-agent command (nvim) → null', () => {
    const r = detectOrc(
      makePane({ command: 'nvim', recentOutput: ['notes about claude and anthropic in this repo'] }),
      defaultDetectors,
    );
    expect(r).toBeNull();
  });

  it('distinctive product markers in output still detect (output-only, capped)', () => {
    const codexHit = detectOrc(
      makePane({ command: 'node', recentOutput: ['OpenAI Codex', 'working on your request'] }),
      defaultDetectors,
    ) as OrcCandidate;
    expect(codexHit.agentType).toBe('codex');
    expect(codexHit.agentTypeConfidence).toBeLessThanOrEqual(0.6);

    const claudeHit = detectOrc(
      makePane({ command: 'node', recentOutput: ['Welcome to Claude Code'] }),
      defaultDetectors,
    ) as OrcCandidate;
    expect(claudeHit.agentType).toBe('claude-code');
    expect(claudeHit.agentTypeConfidence).toBeLessThanOrEqual(0.6);
  });

  it('approval/permission prompts in output still detect (distinctive markers)', () => {
    const codexApproval = detectOrc(
      makePane({ command: 'node', recentOutput: ['Approve this command?'] }),
      defaultDetectors,
    ) as OrcCandidate;
    expect(codexApproval.agentType).toBe('codex');

    const claudePermission = detectOrc(
      makePane({ command: 'node', recentOutput: ['Do you want to proceed?'] }),
      defaultDetectors,
    ) as OrcCandidate;
    expect(claudePermission.agentType).toBe('claude-code');
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

// ===========================================================================
// SPEC-003 §3.1.1 / §3.2-3 / §3.4 — G-PROC (process subtree), residual cap, multi-agent
// ===========================================================================

function node(pid: number, ppid: number, depth: number, command: string): ProcessNode {
  return { pid, ppid, depth, command };
}

// --- TC-U-DET-PROC — G-PROC recall + exec-token precision (AC-10/15/16) ------

describe('TC-U-DET-PROC (SPEC-003-AC-10/15/16) — G-PROC exec/module token', () => {
  it('AC-10: wrapper chain with agent argv in a DESCENDANT → claude-code HIGH, Tier A process', () => {
    const tree = [
      node(1000, 1, 0, '-zsh'),
      node(2000, 1000, 1, 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js'),
      node(2001, 2000, 2, 'npm exec'),
    ];
    const r = detectOrc(makePane({ command: 'node', processTree: tree }), defaultDetectors);
    const c = r as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(c.agentTypeConfidence).toBeGreaterThanOrEqual(0.85);
    expect(isHigh(c.agentTypeConfidence)).toBe(true);
    const proc = c.matchedSignals.find((s) => s.signal === 'process');
    expect(proc?.tier).toBe('A');
    expect(c.processCorroborated).toBe(true);
  });

  it('AC-16: generic runtime + package-id path-segment fires G-PROC (module token)', () => {
    const tree = [node(1000, 1, 0, 'node /x/node_modules/@openai/codex/bin/codex.js')];
    const c = detectOrc(makePane({ command: 'node', processTree: tree }), defaultDetectors) as OrcCandidate;
    expect(c.agentType).toBe('codex');
    expect(c.matchedSignals.some((s) => s.signal === 'process' && s.tier === 'A')).toBe(true);
    expect(c.processCorroborated).toBe(true);
  });

  it('AC-16: installed-entry basename (…/bin/claude under a runtime) fires G-PROC', () => {
    const tree = [node(1000, 1, 0, 'node /opt/claude-code/bin/claude')];
    const c = detectOrc(makePane({ command: 'node', processTree: tree }), defaultDetectors) as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(c.processCorroborated).toBe(true);
  });

  it('AC-15 (negative): runtime running a user script with a mere path SUBSTRING does NOT match', () => {
    const tree = [
      node(1000, 1, 0, '-zsh'),
      node(2000, 1000, 1, 'node /home/u/claude-notes/build.js'),
      node(2001, 1000, 1, 'python codex_experiment.py'),
    ];
    const r = detectOrc(makePane({ command: 'zsh', processTree: tree }), defaultDetectors);
    expect(r).toBeNull(); // no exec/package token → no G-PROC, no other signal → non-candidate
  });

  it('AC-15 (negative): a bare agent name as a non-exec argv token does not fire', () => {
    const tree = [node(1000, 1, 0, 'node build.js --label claude')];
    const r = detectOrc(makePane({ command: 'zsh', processTree: tree }), defaultDetectors);
    expect(r).toBeNull();
  });
});

// --- TC-U-DET-RESIDUAL — residual cap + degrade + monotonicity (AC-11/12/14) -

describe('TC-U-DET-RESIDUAL (SPEC-003-AC-11/12/14) — process-uncorroborated residual', () => {
  it('AC-11: subtree available + no agent + stale title → candidate kept but LOW (residual cap)', () => {
    const tree = [node(1000, 1, 0, '-zsh')]; // shell only; no agent process anywhere
    const c = detectOrc(
      makePane({ command: 'zsh', paneTitle: '✳ Claude Code', processTree: tree }),
      defaultDetectors,
    ) as OrcCandidate;
    expect(c.agentType).toBe('claude-code'); // title still names the agent
    expect(c.agentTypeConfidence).toBeLessThanOrEqual(0.49);
    expect(isLow(c.agentTypeConfidence)).toBe(true);
    expect(c.processCorroborated).toBe(false);
    expect(c.matchedSignals.some((s) => s.signal === 'command' || s.signal === 'process')).toBe(false);
  });

  it('AC-12: processTree absent (introspection unavailable) → NO residual cap (no regression)', () => {
    const c = detectOrc(
      makePane({ command: 'zsh', paneTitle: '✳ Claude Code' }), // no processTree
      defaultDetectors,
    ) as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(c.agentTypeConfidence).toBeGreaterThanOrEqual(0.5); // Tier B title, uncapped
    expect(isMedium(c.agentTypeConfidence)).toBe(true);
  });

  it('AC-14: process-corroborated (live) ranks strictly above residual (title-only)', () => {
    const live = detectOrc(
      makePane({
        command: 'node',
        processTree: [node(1000, 1, 0, 'node /x/@anthropic-ai/claude-code/cli.js')],
      }),
      defaultDetectors,
    ) as OrcCandidate;
    const residual = detectOrc(
      makePane({ command: 'zsh', paneTitle: '✳ Claude Code', processTree: [node(1000, 1, 0, '-zsh')] }),
      defaultDetectors,
    ) as OrcCandidate;
    expect(live.agentTypeConfidence).toBeGreaterThan(residual.agentTypeConfidence);
  });
});

// --- AC-13 — multiple live agents in one subtree → foreground-most (depth) ----

describe('SPEC-003-AC-13 multi-agent subtree → smaller-depth wins, tie → unknown', () => {
  it('picks the agent whose live process is closest to depth-0 (smaller depth)', () => {
    const tree = [
      node(1000, 1, 0, '-zsh'),
      node(2000, 1000, 1, 'node /x/@anthropic-ai/claude-code/cli.js'), // claude at depth 1
      node(2001, 2000, 2, 'node /x/@openai/codex/bin.js'), // codex at depth 2
    ];
    const c = detectOrc(makePane({ command: 'zsh', processTree: tree }), defaultDetectors) as OrcCandidate;
    expect(c.agentType).toBe('claude-code');
    expect(c.matchedSignals.some((s) => s.matchedType === 'codex')).toBe(true); // conflict recorded
  });

  it('two agents at the SAME depth → unknown (no false assertion)', () => {
    const tree = [
      node(1000, 1, 0, '-zsh'),
      node(2000, 1000, 1, 'node /x/@anthropic-ai/claude-code/cli.js'),
      node(2001, 1000, 1, 'node /x/@openai/codex/bin.js'),
    ];
    const c = detectOrc(makePane({ command: 'zsh', processTree: tree }), defaultDetectors) as OrcCandidate;
    expect(c.agentType).toBe('unknown');
    expect(isLow(c.agentTypeConfidence)).toBe(true);
  });
});
