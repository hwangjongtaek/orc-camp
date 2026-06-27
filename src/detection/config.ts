/**
 * SPEC-800 §3.2 — config-driven detector rules (R-P1-011, the P1 extension path).
 *
 * This module is the MVP-grounded slice of SPEC-800: it makes the per-agent
 * signature / banner / command patterns LOADABLE from a declarative config object
 * so a new agent (or a tweaked signature) can be added WITHOUT editing the
 * combiner (`detect.ts`) or the existing inline adapters (open/closed, R-ORC-007,
 * SPEC-003-AC-07 / SPEC-800-AC-01/03).
 *
 * Layering (SPEC-800 §3.3 table):
 *   - MVP (scan)  : inline builtin detectors (`adapters/*.ts`, `defaultDetectors`).
 *   - P1 (here)   : config-declared rules compiled into the SAME `AgentDetector`
 *                   shape → same `OrcCandidate`/`SignalMatch` → same combiner.
 * The inline builtins stay the production default (unchanged). The values below
 * mirror them in `DEFAULT_DETECTOR_CONFIG` so the config path is provably
 * equivalent (see tests/unit/extensibility.test.ts) and so a config that omits an
 * agent still gets the curated, calibrated baseline.
 *
 * INVARIANTS INHERITED (SPEC-800 §3.5 — a config rule can ADD signals only, never
 * weaken the model):
 *   - data-only: a rule cannot run code. Match operators are an allowlist
 *     (`equals` | `contains` | `regex`); regex is bounded (ReDoS guard, §3.2-2).
 *   - read-only / redaction: `detect()` consumes only the already-redacted,
 *     read-only `PaneSignal`; it touches no tmux/fs/network (SPEC-006, D-016/D-019).
 *   - calibration ownership stays in SPEC-003: a rule picks a `tier`, NOT a number.
 *     Tier→base/cap/bonus is applied by the combiner, so an output-only (Tier C)
 *     rule is still capped (≤ 0.60) and can never reach the HIGH band (R-ORC-002).
 *   - provenance: matches record a `ruleId` only — never the matched raw text
 *     (SPEC-006 non-storage).
 *
 * Every numeric threshold / pattern here is a PoC HYPOTHESIS (SPEC-003 §6), not a
 * frozen value.
 *
 * NOTE: imports ONLY `../types` (the frozen contract). It deliberately does NOT
 * import from `./detect` so there is no import cycle (`detect.ts` re-exports from
 * here, one direction only).
 */
import type { AgentDetector, AgentType, OrcCandidate, PaneSignal, SignalMatch } from '../types';

export type { AgentDetector } from '../types';

// ---------------------------------------------------------------------------
// Extension-point version (SPEC-800 §2.3 / §3.4)
// ---------------------------------------------------------------------------

/**
 * Detector extension-point version. Every registered detector (builtin/config/
 * plugin) declares an `interfaceVersion`; the host registers only same-MAJOR
 * detectors and rejects the rest fail-soft (SPEC-800 §3.4, SPEC-800-AC-07).
 */
export const DETECTOR_API_VERSION = '1.0.0';

/** Current config-schema version (SPEC-800 §3.2 `schemaVersion`). */
export const DETECTOR_CONFIG_SCHEMA_VERSION = 1;

/**
 * Bounded regex source length — a conservative ReDoS guard for user-authored
 * patterns (SPEC-800 §3.2-2). The concrete bound is an OPEN QUESTION / hypothesis
 * (SPEC-800 §6: "config regex 안전 한계"); execution-time bounding is a forward
 * item (검토 필요). Builtin sources are well under this.
 */
export const MAX_PATTERN_SOURCE_LEN = 512;

// ---------------------------------------------------------------------------
// Config schema (SPEC-800 §3.2) — declarative, data-only
// ---------------------------------------------------------------------------

/**
 * Match-operator allowlist (SPEC-800 §3.2-2). No code execution, no arbitrary
 * functions: just `equals` (exact, case-insensitive — e.g. command basename),
 * `contains` (substring), `regex` (bounded, compiled case-insensitive).
 */
export type PatternSpec =
  | { readonly equals: readonly string[] }
  | { readonly contains: readonly string[] }
  | { readonly regex: string };

/**
 * One config-declared detector rule. Compiles to a single `AgentDetector` that
 * runs the SPEC-003 §3.1 signal ladder (G-CMD → G-WRAP/G-TITLE → G-OUT).
 */
export interface DetectorRuleConfig {
  /** AgentType this rule claims. Must be unique in the registry (SPEC-800 §3.1). */
  readonly id: string;
  /** DETECTOR_API_VERSION this rule targets; defaults to current. Major-checked (§3.4). */
  readonly interfaceVersion?: string;
  /** G-CMD (Tier A): exact `currentCommand` basenames (compared lowercased). */
  readonly commands: readonly string[];
  /** G-WRAP / G-TITLE (Tier B): signature tested against cmdline / paneTitle. */
  readonly signature: PatternSpec;
  /**
   * G-OUT (Tier C): DISTINCTIVE output banner tested against the redacted tail.
   * CALIBRATION CONTRACT (SPEC-003 §6, 2026-06-27): this MUST stay distinctive —
   * bare single tokens (`\bcodex\b` / `\bclaude\b`) over-detect non-agent panes
   * and are forbidden in the OUTPUT path. Output-only matches are capped ≤ 0.60.
   */
  readonly banner: PatternSpec;
  /** Generic runtimes for the G-WRAP case; defaults to DEFAULT_GENERIC_RUNTIMES. */
  readonly genericRuntimes?: readonly string[];
  /** ruleId prefix in provenance; defaults to `id`. */
  readonly ruleIdPrefix?: string;
}

/** Top-level config object (SPEC-800 §3.2). */
export interface DetectorRulesConfig {
  readonly schemaVersion?: number;
  readonly detectors: readonly DetectorRuleConfig[];
}

/** A per-rule load diagnostic (SPEC-800 §3.1/§3.2-5/§3.4 — fail-soft). */
export interface DetectorDiagnostic {
  /** Identifier only — never raw pane content (config-derived). */
  readonly sourceRef: string;
  readonly code:
    | 'missing_id'
    | 'duplicate_id'
    | 'invalid_pattern'
    | 'incompatible_version'
    | 'invalid_commands';
  readonly message: string;
}

/** Result of compiling a config: the valid detectors + per-rule diagnostics. */
export interface CompileResult {
  readonly detectors: AgentDetector[];
  readonly diagnostics: DetectorDiagnostic[];
}

export interface BuildOptions {
  /** Prepend the calibrated builtin detectors (claude-code/codex). Default true. */
  readonly includeBuiltins?: boolean;
}

// ---------------------------------------------------------------------------
// SPEC-003 §3.2 confidence constants (restated here to avoid an import cycle).
// The combiner (detect.ts) recomputes confidence from `matchedSignals`; this is
// only for a standalone `detector.detect(pane)` call to be self-consistent.
// ---------------------------------------------------------------------------

const TIER_BASE: Record<'A' | 'B' | 'C', number> = { A: 0.95, B: 0.7, C: 0.45 };

/** Generic runtimes that may shim an agent → G-WRAP case (SPEC-003 §3.1). */
export const DEFAULT_GENERIC_RUNTIMES: readonly string[] = [
  'node',
  'nodejs',
  'node.js',
  'python',
  'python3',
  'python2',
  'deno',
  'bun',
  'ts-node',
  'tsx',
];

/** Minimal path-basename (idempotent; SPEC-003 §2.1 — mirrors detect.basename). */
function cmdBasename(command: string): string {
  const trimmed = command.trim();
  if (trimmed === '') return '';
  const noTrailing = trimmed.replace(/[/\\]+$/, '');
  const parts = noTrailing.split(/[/\\]/);
  return (parts[parts.length - 1] ?? noTrailing).toLowerCase();
}

/** §3.2 confidence from a set of same-type signals (output-only cap 0.60). */
function confFromSignals(signals: SignalMatch[]): number {
  const maxBase = Math.max(...signals.map((s) => TIER_BASE[s.tier]));
  const corroborated = Math.min(0.99, maxBase + 0.03 * (signals.length - 1));
  const outputOnly = signals.every((s) => s.tier === 'C');
  return outputOnly ? Math.min(corroborated, 0.6) : corroborated;
}

// ---------------------------------------------------------------------------
// Pattern compilation (data-only, bounded)
// ---------------------------------------------------------------------------

type Predicate = (text: string) => boolean;

/**
 * Compile a `PatternSpec` into a pure text predicate, or throw on an invalid /
 * unsafe spec (uncompilable regex, over-length source, empty needle list). The
 * caller turns the throw into a fail-soft diagnostic (SPEC-800 §3.2-5).
 */
function compilePattern(spec: PatternSpec): Predicate {
  if ('regex' in spec) {
    if (typeof spec.regex !== 'string' || spec.regex.length === 0) {
      throw new Error('regex pattern must be a non-empty string');
    }
    if (spec.regex.length > MAX_PATTERN_SOURCE_LEN) {
      throw new Error(`regex source exceeds ${MAX_PATTERN_SOURCE_LEN} chars`);
    }
    const re = new RegExp(spec.regex, 'i'); // may throw on invalid source
    return (text: string) => re.test(text);
  }
  if ('contains' in spec) {
    const needles = spec.contains.map((n) => n.toLowerCase());
    if (needles.length === 0) throw new Error('contains needs ≥1 needle');
    return (text: string) => {
      const hay = text.toLowerCase();
      return needles.some((n) => n.length > 0 && hay.includes(n));
    };
  }
  if ('equals' in spec) {
    const values = spec.equals.map((v) => v.toLowerCase());
    if (values.length === 0) throw new Error('equals needs ≥1 value');
    return (text: string) => values.includes(text.toLowerCase());
  }
  throw new Error('pattern must use one of: equals | contains | regex');
}

// ---------------------------------------------------------------------------
// Rule → AgentDetector factory (SPEC-800 §3.2 — compiles to the builtin shape)
// ---------------------------------------------------------------------------

/**
 * Build a single `AgentDetector` from a config rule. The compiled detect()
 * reproduces the SPEC-003 §3.1 ladder EXACTLY as the inline adapters do
 * (G-CMD Tier A → G-WRAP/G-TITLE Tier B → G-OUT Tier C), with identical ruleId
 * conventions, so a config-compiled detector is indistinguishable from a builtin
 * to the combiner (SPEC-800-AC-08, packaging-agnostic).
 *
 * Throws if the rule's signature/banner pattern is invalid (fail-closed per rule);
 * `compileDetectors` catches this for fail-soft loading.
 */
export function createDetectorFromRule(rule: DetectorRuleConfig): AgentDetector {
  const id = rule.id as AgentType;
  const prefix = rule.ruleIdPrefix ?? rule.id;
  const commands = new Set(rule.commands.map((c) => c.toLowerCase()));
  const runtimes = new Set((rule.genericRuntimes ?? DEFAULT_GENERIC_RUNTIMES).map((r) => r.toLowerCase()));
  const sigTest = compilePattern(rule.signature);
  const bannerTest = compilePattern(rule.banner);

  return {
    id,
    detect(pane: PaneSignal): OrcCandidate | null {
      const signals: SignalMatch[] = [];
      const currentCommand = cmdBasename(pane.command);

      // G-CMD (Tier A) — direct command basename match.
      if (commands.has(currentCommand)) {
        signals.push({ signal: 'command', tier: 'A', matchedType: id, ruleId: `${prefix}/cmd.basename` });
      }

      const isRuntime = runtimes.has(currentCommand);
      if (isRuntime) {
        // G-WRAP (Tier B) — generic runtime + signature in argv (preferred) or title.
        if (pane.cmdline && sigTest(pane.cmdline)) {
          signals.push({ signal: 'cmdline', tier: 'B', matchedType: id, ruleId: `${prefix}/wrap.cmdline` });
        } else if (pane.paneTitle && sigTest(pane.paneTitle)) {
          signals.push({ signal: 'title', tier: 'B', matchedType: id, ruleId: `${prefix}/wrap.title` });
        }
      } else if (pane.paneTitle && sigTest(pane.paneTitle)) {
        // G-TITLE (Tier B) — title signature regardless of runtime.
        signals.push({ signal: 'title', tier: 'B', matchedType: id, ruleId: `${prefix}/title.signature` });
      }

      // G-OUT (Tier C) — distinctive banner / prompt marker in the redacted tail.
      if (pane.recentOutput.length > 0 && bannerTest(pane.recentOutput.join('\n'))) {
        signals.push({ signal: 'output', tier: 'C', matchedType: id, ruleId: `${prefix}/out.banner` });
      }

      if (signals.length === 0) return null;
      return { agentType: id, agentTypeConfidence: confFromSignals(signals), matchedSignals: signals };
    },
  };
}

// ---------------------------------------------------------------------------
// Default config — mirrors the inline builtins (SPEC-003 §3.1, calibrated 06-27)
// ---------------------------------------------------------------------------

/**
 * Builtin detector rules as config. These VALUES mirror `adapters/claude-code.ts`
 * and `adapters/codex.ts` (the production inline default) and are equivalence-
 * tested against them. The banner patterns are the CALIBRATED (2026-06-27)
 * distinctive markers — note there is NO bare `\bclaude\b` / `\bcodex\b` in any
 * `banner` (that bare word lives only in `signature`, the title/cmdline path,
 * which measured correct). Do NOT loosen the banners (SPEC-003 §6 calibration).
 */
export const DEFAULT_DETECTOR_CONFIG: DetectorRulesConfig = {
  schemaVersion: DETECTOR_CONFIG_SCHEMA_VERSION,
  detectors: [
    {
      id: 'claude-code',
      interfaceVersion: DETECTOR_API_VERSION,
      commands: ['claude', 'claude-code'],
      // bare \bclaude\b is allowed in the SIGNATURE (title/cmdline) path only.
      signature: { regex: '@anthropic-ai/claude-code|claude-code|\\bclaude\\b' },
      // distinctive-only OUTPUT banner (calibrated): no bare \bclaude\b here.
      banner: { regex: 'welcome to claude|claude code|@anthropic-ai/claude-code|do you want to proceed\\?' },
    },
    {
      id: 'codex',
      interfaceVersion: DETECTOR_API_VERSION,
      commands: ['codex'],
      // bare \bcodex\b is allowed in the SIGNATURE (title/cmdline) path only.
      signature: { regex: '@openai/codex|codex-cli|\\bcodex\\b' },
      // distinctive-only OUTPUT banner (calibrated): no bare \bcodex\b here.
      banner: { regex: 'openai codex|@openai/codex|codex-cli|approve this command\\?|allow command\\?' },
    },
  ],
};

// ---------------------------------------------------------------------------
// Registry compile (SPEC-800 §3.1/§3.4 — duplicate-id reject, version check,
// fail-soft per rule)
// ---------------------------------------------------------------------------

/** True iff `declared` shares the MAJOR version of the host API (SPEC-800 §3.4). */
function isCompatibleVersion(declared: string | undefined): boolean {
  if (declared === undefined) return true; // unset → assume current major
  const declaredMajor = declared.split('.')[0];
  const hostMajor = DETECTOR_API_VERSION.split('.')[0];
  return declaredMajor === hostMajor;
}

/**
 * Compile a config into ordered `AgentDetector`s + diagnostics (SPEC-800 §2.3
 * builtin→config order, §3.1 duplicate-id reject, §3.4 version check, §3.2-5
 * fail-soft). Invalid rules are dropped with a diagnostic; valid rules + builtins
 * still load, so scan never crashes on a bad config (SPEC-800-AC-05).
 */
export function compileDetectors(
  config?: DetectorRulesConfig,
  options: BuildOptions = {},
): CompileResult {
  const includeBuiltins = options.includeBuiltins ?? true;
  const detectors: AgentDetector[] = [];
  const diagnostics: DetectorDiagnostic[] = [];
  const seen = new Set<string>();

  // builtin → config order keeps tie-break deterministic (SPEC-800 §2.3).
  if (includeBuiltins) {
    for (const rule of DEFAULT_DETECTOR_CONFIG.detectors) {
      detectors.push(createDetectorFromRule(rule));
      seen.add(rule.id);
    }
  }

  const rules = config?.detectors ?? [];
  rules.forEach((rule, index) => {
    const sourceRef = `config:${rule.id ?? `#${index}`}`;
    if (!rule.id || typeof rule.id !== 'string') {
      diagnostics.push({ sourceRef, code: 'missing_id', message: 'detector rule is missing a non-empty id' });
      return;
    }
    if (!isCompatibleVersion(rule.interfaceVersion)) {
      diagnostics.push({
        sourceRef,
        code: 'incompatible_version',
        message: `interfaceVersion ${rule.interfaceVersion} major mismatches host ${DETECTOR_API_VERSION}`,
      });
      return;
    }
    if (seen.has(rule.id)) {
      // No silent shadow: a config rule cannot quietly override a builtin/earlier
      // rule (SPEC-800 §3.1). Explicit override is a forward Open Question (§6).
      diagnostics.push({ sourceRef, code: 'duplicate_id', message: `duplicate detector id "${rule.id}" rejected` });
      return;
    }
    if (!Array.isArray(rule.commands)) {
      diagnostics.push({ sourceRef, code: 'invalid_commands', message: '`commands` must be an array' });
      return;
    }
    try {
      const detector = createDetectorFromRule(rule);
      detectors.push(detector);
      seen.add(rule.id);
    } catch (err) {
      diagnostics.push({
        sourceRef,
        code: 'invalid_pattern',
        message: err instanceof Error ? err.message : 'invalid pattern',
      });
    }
  });

  return { detectors, diagnostics };
}

/**
 * Convenience factory: the ordered `AgentDetector[]` to hand to `detectOrc`.
 * No config → the calibrated builtins (claude-code/codex). With config → builtins
 * (unless `includeBuiltins:false`) + the valid config detectors. Diagnostics are
 * dropped here; use `compileDetectors` when you need them (e.g. doctor).
 */
export function buildDetectors(config?: DetectorRulesConfig, options?: BuildOptions): AgentDetector[] {
  return compileDetectors(config, options).detectors;
}

// ===========================================================================
// SPEC-800 §3.3 / §4 — FORWARD PRE-FLAGS (framing only; NOT implemented here)
// ===========================================================================
//
// The items below are deliberately NOT built in this MVP increment. They are
// pre-flagged so future slices extend the *surround*, not this detector contract
// (SPEC-800 §4 closing note: P2 work is largely orthogonal to `AgentDetector`).
//
// P1+ (deferred, trust-gated) — code plugin packages (SPEC-800 §3.3):
//   An external npm package exporting `createDetectors(ctx): AgentDetector[]`.
//   Same `AgentDetector` contract → packaging-agnostic, so deferring it does NOT
//   change this interface. Gated behind explicit opt-in + a trust boundary +
//   doctor visibility; in-process JS sandbox enforcement (worker/subprocess) is
//   an Open Question (SPEC-800 §6). `DetectorOrigin`/`RegisteredDetector`
//   provenance metadata (SPEC-800 §2.2) lands with that slice.
//
// P2 (future epics, framing only — SPEC-800 §4):
//   - R-P2-003 remote camps (SSH tunnel)      → transport layer, not detector.
//   - R-P2-004 team read-only observer         → auth/privacy layer, not detector.
//   - R-P2-001 dashboard agent-start           → control layer (violates read-only).
//   - R-P2-006 workflow automation / handoff   → acts on confidence; calibration gate.
//   - R-P2-007 enterprise policy / audit export → policy layer; plugin sandbox.
//
// Status/summary signal config (SPEC-004 axis) is intentionally out of scope:
// this config extends the TYPE axis only (SPEC-800 §6 Open Question).
