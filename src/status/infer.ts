/**
 * SPEC-004 — status / confidence / summary inference.
 *
 * `inferStatus(input)` evaluates the precedence ladder (§3.1):
 *   stale → terminated → tail error → active(working indicator) → tail waiting →
 *   active(change) → waiting(agent at rest) → weak active(generic) → idle → unknown
 * and returns `StatusInference` with `statusConfidence` ALWAYS set. Deterministic:
 * the same `StatusInput` (same `prior`, injected ISO clocks) yields the same
 * output — no `Date.now`, no randomness.
 *
 * Working-vs-waiting (the "running ⇒ always active" fix): for a recognised agent we measure whether
 * a turn is actually IN FLIGHT from the TUI's own affordance (`esc to interrupt` / a working verb…,
 * `detectWorking`) rather than from raw pane-activity time — a running claude-code/codex keeps
 * `pane_activity` fresh via cursor/animation even while idle at its prompt. A known agent that is
 * alive but shows no working indicator and no meaningful change is `waiting` (at its input box), not
 * active; only a working indicator or a real (non-volatile) content change yields `active`.
 *
 * Noise/false-positive suppression:
 *   - `active`  uses region fingerprint compare (./fingerprint): volatile-only
 *     churn (spinner/clock) collapses → never a HIGH `active` (§3.2, AC-04).
 *   - `waiting` requires the prompt in the trailing 1–2 non-empty lines AND, in
 *     diff mode, no meaningful change (§3.3, AC-05/AC-06).
 *   - `error`   requires the error to sit at the tail (last non-empty line is an
 *     error/stack line) so a mid-stream error followed by newer output is not
 *     flagged (§3.1 note, §3.4).
 *
 * Single-shot caps (§3.8): with `prior == null` change-based `active` is not
 * provable → only a weak LOW `active` (S-RECENT) or `unknown`; `waiting` is
 * capped to MEDIUM.
 *
 * Imports ONLY from the frozen contract (`../types`) and the sibling
 * `./fingerprint`. Input is already redacted — this module NEVER redacts, NEVER
 * logs raw output, and provenance carries `ruleId`/enums only. All thresholds /
 * patterns are PoC HYPOTHESES (SPEC-004 §3.9).
 */
import type {
  OrcStatus,
  PaneSignal,
  StatusInference,
  StatusInput,
  StatusSignalMatch,
  SummarySource,
} from '../types';
import { SUMMARY_MAX_LEN, T_ACTIVE_MS, T_IDLE_MS } from '../types';
import { computeFingerprint, EMPTY_LINE_HASH } from './fingerprint';

// --- status confidences (HYPOTHESES, SPEC-004 §3.3/§3.4/§3.7/§3.8) ---------
const CONF = {
  stale: 0.9,
  terminatedDead: 0.95,
  terminatedProc: 0.65,
  agentGone: 0.65, // S-AGONE: subtree present, no live agent process (SPEC-004 §3.7)
  errorTraceback: 0.85,
  errorKeyword: 0.55,
  waitingAdapter: 0.85,
  waitingGeneric: 0.65,
  waitingSingleShotCap: 0.6,
  waitingAgentIdle: 0.62, // S-IDLE-PROMPT: known agent alive, no working indicator → at its prompt
  activeWorking: 0.9, // S-WORK: agent-aware "actually working" indicator in the tail (esc-to-interrupt …)
  activeChangeRecent: 0.85,
  activeChangeOnly: 0.65,
  activeWeakRecent: 0.4,
  idle: 0.65,
  unknown: 0.3,
} as const;

/** SPEC-004 §3.8 — when agent liveness is UNPROVEN (subtree unavailable), `active` may not
 *  reach HIGH (kept strictly inside MEDIUM, < STATUS_BAND HIGH 0.80). */
const LIVENESS_DEGRADE_CAP = 0.79;

// --- pattern sets (HYPOTHESES — adapter-conceptual, embedded here because ----
//     SPEC-004 may not import SPEC-003 adapters; co-tune via SPEC-007) --------

/** Tail error / traceback / exit markers (§3.4). */
const ERROR_LINE =
  /([A-Za-z]*error|[A-Za-z]*exception|panic|fatal|traceback|segmentation fault|core dumped|unhandled|uncaught|command not found)/i;
/** Stack-frame shapes for multi-line traceback detection. */
const STACK_FRAME = /^\s*(File ".*", line \d+|at \S+ \(.+\)|at .+:\d+:\d+)/;
const TRACEBACK_HEADER = /traceback \(most recent call last\)/i;

/** Generic input-wait prompts tested against the LAST non-empty line (§3.3-3). */
const GENERIC_PROMPT_LAST: RegExp[] = [
  /[([][yY]\/[nN][)\]]\s*$/, // (y/n) [Y/n] [y/N]
  /\?\s*$/, // ends with a question
  /^[>❯➜$#]\s*$/, // empty prompt
  /press\s+enter/i,
  /\bcontinue\?/i,
  /\bdo you want to\b/i,
  /^\s*\d+[).]\s+\S+/, // numbered menu item
];

/** Adapter-specific approval/permission prompts (§3.3-4), keyed by agentType. */
const ADAPTER_PROMPTS: Record<string, RegExp[]> = {
  'claude-code': [/do you want to proceed\?/i, /❯\s*\d+\.\s*(yes|no)\b/i, /\bclaude\b.*\?/i],
  codex: [/allow (this )?command\?/i, /approve( this command)?\?/i, /\[a\]llow.*\[d\]eny/i],
};

/**
 * Agent "actively working" markers (§3.2 S-WORK — HYPOTHESES). These are the TUI's OWN
 * "a turn is in flight" affordances: the canonical cross-agent one is the `esc to interrupt`
 * hint shown ONLY while the agent is running a turn — when the turn finishes the TUI redraws its
 * (idle) input box and the hint disappears. This is the single-cycle signal that separates a
 * session that is REALLY working from one that is merely alive (a running TUI keeps `pane_activity`
 * fresh via cursor/animation even while idle at its prompt — the root cause of "running ⇒ active").
 * Spinner glyphs alone are intentionally NOT a marker here (volatile-only churn is suppressed by the
 * fingerprint, §3.2 / AC-04); we require the explicit interrupt-hint or a working verb + ellipsis.
 */
const WORKING_MARKERS_GENERIC: RegExp[] = [
  /esc to interrupt/i,
  /press esc to (interrupt|cancel|stop)/i,
  /ctrl\+c to (interrupt|stop|cancel)/i,
];
const WORKING_MARKERS: Record<string, RegExp[]> = {
  'claude-code': [
    /\b(thinking|working|brewing|forging|pondering|cooking|crunching|herding|distilling|simmering|noodling|churning|baking)…/i,
  ],
  codex: [/\b(thinking|working|running|generating|reasoning)…/i],
};

/**
 * SOFT working sign (§3.2 S-CHG-V): a spinner glyph in the tail means the TUI is actively
 * live-updating (a turn is rendering) — weaker than the explicit interrupt-hint above. It keeps a
 * spinner-churn pane as WEAK `active` (LOW) rather than mislabelling it `waiting`, while a truly
 * static idle input box (no spinner) is left to resolve as `waiting`. Braille + circle spinner
 * classes only (the unambiguous CLI spinner glyphs); box-drawing borders are intentionally excluded.
 */
const SPINNER_GLYPH = /[⠀-⣿◐◑◒◓◴◵◶◷◜◝◞◟]/u;
function detectSpinner(region: string[]): boolean {
  return region.slice(-6).some((l) => SPINNER_GLYPH.test(l));
}

// --- small pure helpers -----------------------------------------------------

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Minimal path-basename (local copy; infer imports only types + fingerprint). */
function baseName(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '') return '';
  const noTrailing = trimmed.replace(/[/\\]+$/, '');
  const parts = noTrailing.split(/[/\\]/);
  return parts[parts.length - 1] ?? noTrailing;
}

/** Trailing up-to-`n` non-empty (rstripped) lines, chronological order. */
function trailingNonEmpty(lines: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    const t = (lines[i] ?? '').replace(/\s+$/, '');
    if (t.trim() === '') continue;
    out.unshift(t);
  }
  return out;
}

/** True if a candidate summary line is nothing but `[REDACTED:...]` placeholders. */
function isAllRedacted(line: string): boolean {
  return line.replace(/\[REDACTED:[^\]]*\]/g, '').trim() === '';
}

/** Last non-empty, not-all-redacted line (privacy skip, AC-13). */
function lastUsableLine(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = (lines[i] ?? '').trim();
    if (t === '' || isAllRedacted(t)) continue;
    return t;
  }
  return null;
}

/** Single-line, length-capped summary (SPEC-004 §3.5, L = SUMMARY_MAX_LEN). */
function truncateSummary(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= SUMMARY_MAX_LEN) return one;
  return one.slice(0, SUMMARY_MAX_LEN - 1) + '…';
}

// --- change detection (region fingerprint, §3.2) ----------------------------

/** null when single-shot (prior absent) — change-based `active` not provable. */
function evaluateMeaningfulChange(input: StatusInput): boolean | null {
  const prior = input.prior;
  if (!prior) return null;
  const current = computeFingerprint(input.pane.recentOutput);
  const priorSet = new Set(prior.captureFingerprint);
  const newMeaningful = current.filter((h) => h !== EMPTY_LINE_HASH && !priorSet.has(h));
  return newMeaningful.length >= 1;
}

// --- tail signal detectors --------------------------------------------------

function detectError(region: string[]): { matched: boolean; multiline: boolean } {
  if (region.length === 0) return { matched: false, multiline: false };
  const last = region[region.length - 1] ?? '';
  const lastIsError = ERROR_LINE.test(last) || STACK_FRAME.test(last);
  if (!lastIsError) return { matched: false, multiline: false };
  const hasHeader = region.some((l) => TRACEBACK_HEADER.test(l));
  const frameCount = region.filter((l) => STACK_FRAME.test(l)).length;
  return { matched: true, multiline: hasHeader || frameCount >= 2 };
}

/**
 * True when the tail shows the agent is ACTIVELY working a turn (§3.2 S-WORK). Checked against the
 * last few non-empty lines (the live status line sits at the bottom of the TUI, just above/around
 * the input box) so a stale interrupt-hint from earlier scrollback is not matched.
 */
function detectWorking(region: string[], agentType: string): boolean {
  if (region.length === 0) return false;
  const tail = region.slice(-6).join('\n');
  if (WORKING_MARKERS_GENERIC.some((re) => re.test(tail))) return true;
  return (WORKING_MARKERS[agentType] ?? []).some((re) => re.test(tail));
}

function detectPrompt(
  promptRegion: string[],
  agentType: string,
): { matched: boolean; specificity: 'adapter' | 'generic' } {
  if (promptRegion.length === 0) return { matched: false, specificity: 'generic' };
  const regionText = promptRegion.join('\n');
  const last = promptRegion[promptRegion.length - 1] ?? '';
  const adapterPats = ADAPTER_PROMPTS[agentType] ?? [];
  if (adapterPats.some((re) => re.test(regionText))) {
    return { matched: true, specificity: 'adapter' };
  }
  if (GENERIC_PROMPT_LAST.some((re) => re.test(last))) {
    return { matched: true, specificity: 'generic' };
  }
  return { matched: false, specificity: 'generic' };
}

// --- summary selection (§3.5) -----------------------------------------------

function isDescriptiveTitle(title: string, pane: PaneSignal): boolean {
  const cmd = baseName(pane.command).toLowerCase();
  const t = title.trim();
  if (t === '') return false;
  if (t.toLowerCase() === cmd) return false;
  if (t === baseName(pane.cwd)) return false;
  if (/^-?(bash|zsh|fish|sh|tmux|dash)$/i.test(t)) return false; // shell default titles
  if (/^[\w.-]+@[\w.-]+/.test(t)) return false; // user@host
  return true;
}

function selectSummary(
  status: OrcStatus,
  input: StatusInput,
): { summary: string | null; source: SummarySource; estimated: boolean } {
  const { pane } = input;

  // 1. user_label — human-authored, trusted (only source that may be non-estimated).
  const ul = input.userLabel?.trim();
  if (ul && ul !== '') {
    return { summary: truncateSummary(ul), source: 'user_label', estimated: false };
  }

  // 2. recent_prompt — only when waiting and a usable prompt line exists.
  if (status === 'waiting') {
    const line = lastUsableLine(pane.recentOutput);
    if (line) return { summary: truncateSummary(line), source: 'recent_prompt', estimated: true };
  }

  // 3. pane_title — when descriptive and not entirely redacted.
  const title = pane.paneTitle?.trim();
  if (title && !isAllRedacted(title) && isDescriptiveTitle(title, pane)) {
    return { summary: truncateSummary(title), source: 'pane_title', estimated: true };
  }

  // 4. recent_output — last usable (non-empty, not all-redacted) line.
  const line = lastUsableLine(pane.recentOutput);
  if (line) return { summary: truncateSummary(line), source: 'recent_output', estimated: true };

  // 5. unknown.
  return { summary: null, source: 'unknown', estimated: true };
}

// --- public entry point -----------------------------------------------------

export function inferStatus(input: StatusInput): StatusInference {
  const { pane, lifecycle, scannedAt, snapshotStale } = input;

  const finalize = (
    status: OrcStatus,
    confidence: number,
    signals: StatusSignalMatch[],
  ): StatusInference => {
    const { summary, source, estimated } = selectSummary(status, input);
    return {
      status,
      statusConfidence: clamp01(confidence),
      statusSignals: signals,
      currentWorkSummary: summary,
      summarySource: source,
      summaryIsEstimated: estimated,
    };
  };

  // 1. stale — data itself is a last-good fallback (checked first: cannot assert
  //    live per-pane state, incl. terminated, on non-fresh data) (§3.1-1/§3.7).
  if (snapshotStale) {
    return finalize('stale', CONF.stale, [
      { signal: 'stale', status: 'stale', strength: 'A', ruleId: 'stale/snapshot' },
    ]);
  }

  // 2. terminated — lifecycle end (§3.1-2/§3.7). pane_dead is authoritative;
  //    processAlive===false is auxiliary (S-PID, MEDIUM — could be a child).
  if (lifecycle.paneDead) {
    return finalize('terminated', CONF.terminatedDead, [
      { signal: 'lifecycle', status: 'terminated', strength: 'A', ruleId: 'terminated/pane_dead' },
    ]);
  }
  if (lifecycle.processAlive === false) {
    return finalize('terminated', CONF.terminatedProc, [
      { signal: 'lifecycle', status: 'terminated', strength: 'B', ruleId: 'terminated/proc_dead' },
    ]);
  }

  // 2b. agent-gone (S-AGONE, liveness-gate) — subtree was collected but holds NO live agent
  //     process (detection rests on a stale pane title / scrollback banner). The pane/shell may
  //     be alive, but THIS agent's lifecycle ended. Precedes the tail ladder so a dead session's
  //     scrollback (error/prompt/change) is never reported as live error/waiting/active
  //     (SPEC-004 §3.1-2b/§3.7, AC-16/17/20). `null` (subtree unavailable) does NOT terminate —
  //     it only degrades `active` below HIGH (§3.8). `undefined` (no info) leaves the gate inert.
  const agentProcessAlive = lifecycle.agentProcessAlive;
  if (agentProcessAlive === false) {
    return finalize('terminated', CONF.agentGone, [
      { signal: 'lifecycle', status: 'terminated', strength: 'B', ruleId: 'terminated/agent_gone' },
    ]);
  }
  const livenessUnproven = agentProcessAlive === null;

  // Shared signals for the tail / time ladder.
  const region = trailingNonEmpty(pane.recentOutput, 8);
  const promptRegion = region.slice(-2);
  const meaningfulChange = evaluateMeaningfulChange(input); // null in single-shot
  const hasOutput = pane.recentOutput.some((l) => l.trim() !== '');
  const inactivityMs = toMs(scannedAt) - toMs(lifecycle.lastActivityAt);
  const recentActive = inactivityMs <= T_ACTIVE_MS;
  const agentType = input.candidate.agentType;
  const knownAgent = agentType !== 'unknown'; // a recognised TUI (claude-code/codex)
  const working = detectWorking(region, agentType); // §3.2 S-WORK — actually working a turn
  const softWorking = detectSpinner(region); // §3.2 S-CHG-V — spinner churn (weak working sign)

  // 3. tail states (require some output).
  if (region.length > 0) {
    // 3a. error — only when the tail itself is an error/stack line (§3.4).
    const err = detectError(region);
    if (err.matched) {
      const conf = err.multiline ? CONF.errorTraceback : CONF.errorKeyword;
      const ruleId = err.multiline ? 'error/traceback' : 'error/keyword';
      const strength: 'A' | 'C' = err.multiline ? 'A' : 'C';
      return finalize('error', conf, [{ signal: 'error', status: 'error', strength, ruleId }]);
    }

    // 3b. active — agent-aware "actually working" indicator in the tail (§3.2 S-WORK). This is the
    //     PRIMARY active signal: it works single-cycle (no prior needed) and, unlike raw activity
    //     time, fires ONLY while a turn is in flight ("esc to interrupt" / working verb…). It comes
    //     BEFORE waiting so a leftover idle prompt does not mask a running turn.
    if (working) {
      let conf: number = CONF.activeWorking;
      if (livenessUnproven) conf = Math.min(conf, LIVENESS_DEGRADE_CAP); // §3.8 degrade
      return finalize('active', conf, [
        { signal: 'change', status: 'active', strength: 'A', ruleId: 'active/working.indicator' },
      ]);
    }

    // 3c. waiting — tail prompt + (diff mode) no meaningful change (§3.3).
    const prompt = detectPrompt(promptRegion, agentType);
    const changeBlocksWaiting = meaningfulChange === true; // only blocks in diff mode
    if (prompt.matched && !changeBlocksWaiting) {
      const isAdapter = prompt.specificity === 'adapter';
      let conf: number = isAdapter ? CONF.waitingAdapter : CONF.waitingGeneric;
      if (!input.prior) conf = Math.min(conf, CONF.waitingSingleShotCap); // static unverifiable
      const ruleId = isAdapter ? 'waiting/prompt.adapter' : 'waiting/prompt.generic';
      const strength: 'A' | 'B' = isAdapter ? 'A' : 'B';
      return finalize('waiting', conf, [{ signal: 'prompt', status: 'waiting', strength, ruleId }]);
    }

    // 3d. active — meaningful region change (diff mode) (§3.2).
    if (meaningfulChange === true) {
      const signals: StatusSignalMatch[] = [
        { signal: 'change', status: 'active', strength: 'A', ruleId: 'active/change.region' },
      ];
      let conf: number = CONF.activeChangeOnly;
      if (recentActive) {
        signals.push({ signal: 'idle_time', status: 'active', strength: 'C', ruleId: 'active/recent' });
        conf = CONF.activeChangeRecent; // corroboration: change + recent activity
      }
      // liveness-gate degrade (§3.8): subtree unavailable → cannot prove a live agent → not HIGH.
      if (livenessUnproven) conf = Math.min(conf, LIVENESS_DEGRADE_CAP);
      return finalize('active', conf, signals);
    }

    // 3e. waiting (agent at rest) — a KNOWN agent (claude-code/codex) that is alive and recently
    //     touched its pane but shows NO working sign (no interrupt-hint, no spinner churn) and no
    //     meaningful change is sitting at its (static) input/approval box: it has finished its turn
    //     and is awaiting the user. Recent pane-activity here is TUI cursor/animation, NOT work — so
    //     it must NOT become `active` (the fix for "running ⇒ always active"). A spinner-churn pane
    //     (softWorking) is excluded here and falls through to the weak-active fallback (§3.2 S-CHG-V).
    //     Less certain than an explicit prompt match → MEDIUM (§3.2 S-IDLE-PROMPT).
    // (meaningfulChange === true already returned at 3d, so here it is false|null.)
    if (knownAgent && recentActive && !softWorking) {
      return finalize('waiting', CONF.waitingAgentIdle, [
        { signal: 'idle_time', status: 'waiting', strength: 'B', ruleId: 'waiting/agent_idle' },
      ]);
    }
  }

  // 4. time-based.
  // 4a. weak active — recent activity but change unprovable (single-shot, or volatile-only churn):
  //     LOW only (§3.8 single-shot cap, §3.2 volatile). Reached for GENERIC/unknown candidates;
  //     a known agent with recent activity but no working indicator resolved to `waiting` at 3e.
  if (recentActive && hasOutput) {
    return finalize('active', CONF.activeWeakRecent, [
      { signal: 'idle_time', status: 'active', strength: 'C', ruleId: 'active/recent.weak' },
    ]);
  }
  // 4b. idle — inactivity past the floor with no other signal (§3.1-4).
  if (inactivityMs > T_IDLE_MS) {
    return finalize('idle', CONF.idle, [
      { signal: 'idle_time', status: 'idle', strength: 'B', ruleId: 'idle/inactive' },
    ]);
  }

  // 5. unknown — nothing provable (§3.1-5). statusConfidence still returned.
  return finalize('unknown', CONF.unknown, []);
}
