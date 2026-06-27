/**
 * SPEC-800 — config-driven detector extensibility (R-P1-011, R-ORC-007).
 *
 * Proves the three load-bearing properties of the increment:
 *   (a) the config path reproduces the inline builtins BYTE-FOR-BYTE (default
 *       behavior unchanged — SPEC-800 §3.2/§3.3, equivalence);
 *   (b) a NEW agent type / signature is detected via the factory + the SAME
 *       combiner with zero edits to the combiner or existing adapters
 *       (R-ORC-007, SPEC-003-AC-07 / SPEC-800-AC-01/03);
 *   (c) the calibrated OUTPUT banner stays distinctive — a bare-word output still
 *       does NOT detect (no 2026-06-27 calibration regression).
 *
 * Plus SPEC-800-AC-02/04/05/07: duplicate-id reject, output-only cap, fail-soft
 * invalid rules, interfaceVersion compatibility. Deterministic; placeholder text.
 */
import { describe, expect, it } from 'vitest';
import type { AgentType, OrcCandidate, PaneSignal } from '../../src/types';
import { AGENT_BAND } from '../../src/types';
import { claudeCode } from '../../src/detection/adapters/claude-code';
import { codex } from '../../src/detection/adapters/codex';
import { defaultDetectors, detectOrc } from '../../src/detection/detect';
import {
  DEFAULT_DETECTOR_CONFIG,
  DETECTOR_API_VERSION,
  buildDetectors,
  compileDetectors,
  createDetectorFromRule,
  type DetectorRuleConfig,
  type DetectorRulesConfig,
} from '../../src/detection/config';

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

/**
 * A battery covering every SPEC-003 §3.1 signal path + combiner branch, reused to
 * compare the inline builtins against the config-compiled builtins.
 */
const BATTERY: PaneSignal[] = [
  makePane({ command: 'claude' }), // G-CMD claude
  makePane({ command: 'claude-code' }), // G-CMD claude-code
  makePane({ command: '/usr/local/bin/claude' }), // G-CMD full path
  makePane({ command: 'codex' }), // G-CMD codex
  makePane({ command: 'node', cmdline: 'node /lib/@anthropic-ai/claude-code/cli.js' }), // G-WRAP cmdline
  makePane({ command: 'node', cmdline: null, paneTitle: 'claude-code — refactor' }), // G-WRAP title fallback
  makePane({ command: 'python3', paneTitle: 'codex session' }), // G-WRAP title
  makePane({ command: 'emacs', paneTitle: '✳ Claude Code' }), // G-TITLE non-runtime
  makePane({ command: 'node', recentOutput: ['', 'Welcome to Claude Code', 'thinking...'] }), // G-OUT cap
  makePane({ command: 'node', recentOutput: ['OpenAI Codex', 'working'] }), // G-OUT codex
  makePane({ command: 'node', recentOutput: ['Approve this command?'] }), // G-OUT approval
  makePane({ command: 'claude', recentOutput: ['✻ Welcome to Claude Code'] }), // corroboration A+C
  makePane({ command: 'claude', recentOutput: ['OpenAI Codex session started'] }), // conflict unique-best
  makePane({ command: 'node', recentOutput: ['Welcome to Claude Code', 'OpenAI Codex session started'] }), // tie
  makePane({ command: 'node', paneTitle: 'my assistant runner', recentOutput: ['ready'] }), // ambiguous marker
  makePane({ command: 'zsh' }), // non-candidate
  makePane({ command: 'node', cmdline: 'node server.js', recentOutput: ['listening on :3000'] }), // plain node
  makePane({ command: 'nvim', recentOutput: ['the codex spec mentions orcs'] }), // bare-word codex
  makePane({ command: 'nvim', recentOutput: ['notes about claude and anthropic'] }), // bare-word claude
];

// ===========================================================================
// (a) DEFAULT BEHAVIOR UNCHANGED — config builtins ≡ inline builtins
// ===========================================================================

describe('SPEC-800 — config-compiled builtins reproduce inline builtins byte-for-byte', () => {
  it('buildDetectors() exposes exactly the builtin ids in order', () => {
    expect(buildDetectors().map((d) => d.id)).toEqual(['claude-code', 'codex']);
  });

  it('detectOrc output is identical via inline vs config-compiled builtins (full battery)', () => {
    const configBuiltins = buildDetectors(); // no config → calibrated builtins
    for (const pane of BATTERY) {
      const inline = detectOrc(pane, defaultDetectors);
      const fromConfig = detectOrc(pane, configBuiltins);
      // deep equality incl. agentType, confidence, and every matchedSignals ruleId.
      expect(fromConfig).toEqual(inline);
    }
  });

  it('per-adapter detect() (incl. ruleIds) matches the inline adapter', () => {
    const cfgClaude = createDetectorFromRule(DEFAULT_DETECTOR_CONFIG.detectors[0]!);
    const cfgCodex = createDetectorFromRule(DEFAULT_DETECTOR_CONFIG.detectors[1]!);
    for (const pane of BATTERY) {
      expect(cfgClaude.detect(pane)).toEqual(claudeCode.detect(pane));
      expect(cfgCodex.detect(pane)).toEqual(codex.detect(pane));
    }
  });

  it('compiling the default config yields no diagnostics', () => {
    const { detectors, diagnostics } = compileDetectors(DEFAULT_DETECTOR_CONFIG, { includeBuiltins: false });
    expect(diagnostics).toEqual([]);
    expect(detectors.map((d) => d.id)).toEqual(['claude-code', 'codex']);
  });
});

// ===========================================================================
// (b) NEW AGENT via config — no combiner/adapter edits (R-ORC-007, AC-01/03)
// ===========================================================================

describe('SPEC-800-AC-01/03 — a new agent type is added via config only', () => {
  const fooId = 'foo-agent' as unknown as AgentType;
  const fooConfig: DetectorRulesConfig = {
    schemaVersion: 1,
    detectors: [
      {
        id: fooId,
        interfaceVersion: DETECTOR_API_VERSION,
        commands: ['fooagent', 'foo'],
        signature: { regex: '@acme/foo-agent|foo-?agent' },
        banner: { contains: ['FooAgent session ready'] },
      },
    ],
  };

  it('G-CMD: direct command → new type, HIGH, Tier A (combiner untouched)', () => {
    const detectors = buildDetectors(fooConfig); // builtins + foo
    const r = detectOrc(makePane({ command: 'fooagent' }), detectors) as OrcCandidate;
    expect(r.agentType).toBe(fooId);
    expect(isHigh(r.agentTypeConfidence)).toBe(true);
    expect(r.matchedSignals.some((s) => s.tier === 'A')).toBe(true);
    // provenance ruleId is config-shaped (never raw text).
    expect(r.matchedSignals[0]!.ruleId).toBe('foo-agent/cmd.basename');
  });

  it('G-WRAP: generic runtime + signature → new type, MEDIUM, Tier B', () => {
    const detectors = buildDetectors(fooConfig);
    const r = detectOrc(
      makePane({ command: 'node', cmdline: 'node /lib/@acme/foo-agent/cli.js' }),
      detectors,
    ) as OrcCandidate;
    expect(r.agentType).toBe(fooId);
    expect(isMedium(r.agentTypeConfidence)).toBe(true);
    expect(r.matchedSignals.some((s) => s.tier === 'B')).toBe(true);
  });

  it('uses the SAME imported combiner — adding foo does not regress builtin panes', () => {
    const detectors = buildDetectors(fooConfig);
    expect(detectOrc(makePane({ command: 'claude' }), detectors)?.agentType).toBe('claude-code');
    expect(detectOrc(makePane({ command: 'codex' }), detectors)?.agentType).toBe('codex');
    expect(detectOrc(makePane({ command: 'zsh' }), detectors)).toBeNull();
    // and a foo pane is a non-candidate for the builtins-only registry.
    expect(detectOrc(makePane({ command: 'fooagent' }), defaultDetectors)).toBeNull();
  });
});

// ===========================================================================
// (c) CALIBRATION — bare-word OUTPUT still does NOT detect (no regression)
// ===========================================================================

describe('SPEC-800 — config path preserves the 2026-06-27 OUTPUT calibration', () => {
  it('bare "codex"/"claude" in output (non-agent command) → null via config builtins', () => {
    const detectors = buildDetectors();
    expect(
      detectOrc(makePane({ command: 'nvim', recentOutput: ['the codex spec mentions orcs'] }), detectors),
    ).toBeNull();
    expect(
      detectOrc(makePane({ command: 'nvim', recentOutput: ['notes about claude and anthropic'] }), detectors),
    ).toBeNull();
  });

  it('the default config banner contains no bare \\bclaude\\b / \\bcodex\\b alternative', () => {
    for (const rule of DEFAULT_DETECTOR_CONFIG.detectors) {
      expect('regex' in rule.banner).toBe(true);
      const src = (rule.banner as { regex: string }).regex;
      expect(src).not.toMatch(/\\bclaude\\b/);
      expect(src).not.toMatch(/\\bcodex\\b/);
    }
  });

  it('distinctive product markers in output still detect (output-only, capped)', () => {
    const detectors = buildDetectors();
    const hit = detectOrc(
      makePane({ command: 'node', recentOutput: ['OpenAI Codex'] }),
      detectors,
    ) as OrcCandidate;
    expect(hit.agentType).toBe('codex');
    expect(hit.agentTypeConfidence).toBeLessThanOrEqual(0.6);
  });
});

// ===========================================================================
// SPEC-800-AC-04 — output-only (Tier C) config rule is capped, never HIGH
// ===========================================================================

describe('SPEC-800-AC-04 — config cannot bypass the output-only cap', () => {
  it('a Tier-C-only config agent caps confidence ≤ 0.60 (no HIGH band)', () => {
    const cfg: DetectorRulesConfig = {
      detectors: [
        {
          id: 'banner-only' as unknown as AgentType,
          commands: [],
          // signature can never fire (no runtime/title path used by this pane)
          signature: { regex: 'zzz-never-matches-zzz' },
          banner: { contains: ['BannerOnly Agent ready'] },
        },
      ],
    };
    const r = detectOrc(
      makePane({ command: 'node', recentOutput: ['BannerOnly Agent ready'] }),
      buildDetectors(cfg),
    ) as OrcCandidate;
    expect(r.agentType).toBe('banner-only');
    expect(r.agentTypeConfidence).toBeLessThanOrEqual(0.6);
    expect(isHigh(r.agentTypeConfidence)).toBe(false);
    expect(r.matchedSignals.every((s) => s.tier === 'C')).toBe(true);
  });
});

// ===========================================================================
// SPEC-800-AC-02/05/07 — fail-soft: duplicate id, invalid pattern, bad version
// ===========================================================================

describe('SPEC-800-AC-02/05/07 — fail-soft compile diagnostics', () => {
  it('AC-02: a config id colliding with a builtin is rejected, builtins survive', () => {
    const cfg: DetectorRulesConfig = {
      detectors: [{ id: 'codex', commands: ['codex'], signature: { regex: 'x' }, banner: { regex: 'y' } }],
    };
    const { detectors, diagnostics } = compileDetectors(cfg);
    expect(detectors.map((d) => d.id)).toEqual(['claude-code', 'codex']); // only the builtin codex
    expect(diagnostics.some((d) => d.code === 'duplicate_id')).toBe(true);
    // scan still works through the surviving builtin.
    expect(detectOrc(makePane({ command: 'codex' }), detectors)?.agentType).toBe('codex');
  });

  it('AC-05: an invalid (uncompilable) regex rule is dropped, others + builtins load', () => {
    const cfg: DetectorRulesConfig = {
      detectors: [
        { id: 'bad', commands: ['bad'], signature: { regex: '([' }, banner: { regex: 'b' } }, // invalid regex
        { id: 'good', commands: ['good'], signature: { regex: 'good' }, banner: { contains: ['Good ready'] } },
      ],
    };
    const { detectors, diagnostics } = compileDetectors(cfg);
    expect(detectors.map((d) => d.id)).toEqual(['claude-code', 'codex', 'good']);
    expect(diagnostics.some((d) => d.code === 'invalid_pattern' && d.sourceRef === 'config:bad')).toBe(true);
    expect(detectOrc(makePane({ command: 'good' }), detectors)?.agentType).toBe('good');
  });

  it('AC-05: an over-length regex source is rejected as invalid_pattern', () => {
    const cfg: DetectorRulesConfig = {
      detectors: [
        { id: 'huge', commands: ['huge'], signature: { regex: 'a'.repeat(600) }, banner: { regex: 'b' } },
      ],
    };
    const { diagnostics } = compileDetectors(cfg, { includeBuiltins: false });
    expect(diagnostics.some((d) => d.code === 'invalid_pattern')).toBe(true);
  });

  it('AC-07: a major-incompatible interfaceVersion is rejected, others load', () => {
    const cfg: DetectorRulesConfig = {
      detectors: [
        {
          id: 'v2',
          interfaceVersion: '2.0.0',
          commands: ['v2'],
          signature: { regex: 'v2' },
          banner: { regex: 'v2' },
        } satisfies DetectorRuleConfig,
      ],
    };
    const { detectors, diagnostics } = compileDetectors(cfg);
    expect(detectors.map((d) => d.id)).toEqual(['claude-code', 'codex']);
    expect(diagnostics.some((d) => d.code === 'incompatible_version')).toBe(true);
  });

  it('missing id is rejected with a diagnostic', () => {
    const cfg = { detectors: [{ commands: ['x'], signature: { regex: 'x' }, banner: { regex: 'y' } }] } as unknown as DetectorRulesConfig;
    const { diagnostics } = compileDetectors(cfg, { includeBuiltins: false });
    expect(diagnostics.some((d) => d.code === 'missing_id')).toBe(true);
  });
});

// ===========================================================================
// determinism — config-driven detection stays deterministic (SPEC-800 §2.3)
// ===========================================================================

describe('SPEC-800 — config-driven detection is deterministic', () => {
  it('repeated detectOrc over a config registry yields identical results', () => {
    const detectors = buildDetectors({
      detectors: [
        { id: 'det', commands: ['det'], signature: { regex: 'det' }, banner: { contains: ['Det ready'] } },
      ],
    });
    const pane = makePane({ command: 'det' });
    expect(detectOrc(pane, detectors)).toEqual(detectOrc(pane, detectors));
  });
});
