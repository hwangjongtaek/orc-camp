/**
 * SPEC-006 §2.8 — ANSI/styled stream redaction primitives (pure, catalog-agnostic).
 *
 * These functions realize the frozen algorithm (SPEC-006 §2.8, D-042):
 *   tokenize → strip ALL ESC/C0/C1 → (caller: plain-redact) → style re-map.
 * They are pure and know NOTHING about the redaction catalog — the catalog is
 * applied by `redact()` between the strip and the re-map, so there is exactly one
 * redaction chokepoint (no catalog duplication). The public entry point that wires
 * these together with `redact()` is `sanitizeStyledCapture()` in ./redact.ts.
 *
 * Wire-form invariants (SPEC-103 §2.3.1) enforced here:
 *  - `spans[i]` offsets index the ALREADY-REDACTED `lines[i]` (UTF-16 code units).
 *  - a span never crosses/splits a `[REDACTED:<class>]` token (clipped at edges).
 *  - `sgr` is the fully-accumulated SGR state for the run, serialized to `[0-9;]`
 *    params only (client renders `ESC[<sgr>m … ESC[0m`). No raw escape byte ever
 *    leaves this module in a span.
 */
import { MAX_SPANS_PER_LINE, SGR_RE, type StyleSpan } from '../server/live-view';

const ESC = 0x1b;
const LF = 0x0a;

/** A recorded SGR state change at a plain-text offset (UTF-16 code unit). */
interface SgrEvent {
  offset: number; // position in the built plain string where this style takes effect
  params: string; // raw CSI parameter string between `[` and `m`, charset [0-9;:]
}

/** Result of stripping every escape/control from a `-e` capture. */
export interface StripResult {
  plain: string; // pure text: no ESC, no C0 except LF, no C1 — matches the plain path's input
  events: SgrEvent[]; // SGR state changes at plain offsets, in order
}

const isCsiParam = (c: number): boolean => c >= 0x30 && c <= 0x3f; // 0-9 : ; < = > ?
const isCsiIntermediate = (c: number): boolean => c >= 0x20 && c <= 0x2f; // space ! " ... /
const isCsiFinal = (c: number): boolean => c >= 0x40 && c <= 0x7e; // @ A-Z [ ] ... ~
const isSgrParamChar = (c: number): boolean => (c >= 0x30 && c <= 0x39) || c === 0x3b || c === 0x3a; // [0-9;:]

/**
 * Strip ALL ESC-introduced sequences and C0/C1 control chars (except LF) from a
 * `capture-pane -e` buffer, producing pure plain text plus the SGR state-change
 * events at their plain-text offsets. Non-SGR escapes (OSC/DCS/CSI-non-`m`/private
 * CSI/single-char ESC) are consumed and dropped WITHOUT an event, so no surviving
 * escape can re-split a secret in the joined plain (T-13). Only a well-formed SGR
 * (`ESC [ <[0-9;:]*> m`) yields an event.
 */
export function stripAnsi(rawE: string): StripResult {
  const events: SgrEvent[] = [];
  let plain = '';
  let i = 0;
  const n = rawE.length;

  while (i < n) {
    const c = rawE.charCodeAt(i);

    if (c === ESC) {
      const next = i + 1 < n ? rawE.charCodeAt(i + 1) : -1;
      if (next === 0x5b) {
        // CSI: ESC [ <params> <intermediates> <final>
        let j = i + 2;
        while (j < n && isCsiParam(rawE.charCodeAt(j))) j += 1;
        const paramEnd = j;
        while (j < n && isCsiIntermediate(rawE.charCodeAt(j))) j += 1;
        if (j < n && isCsiFinal(rawE.charCodeAt(j))) {
          const finalByte = rawE.charCodeAt(j);
          const params = rawE.slice(i + 2, paramEnd);
          // Only a `m` final with a pure [0-9;:] param body is a real SGR. Anything
          // else (cursor moves, private `<=>?` params, intermediates) is stripped
          // with no event — malformed/private SGR never produces a span.
          const paramsAreSgr = [...params].every((ch) => isSgrParamChar(ch.charCodeAt(0)));
          if (finalByte === 0x6d && paramsAreSgr) {
            events.push({ offset: plain.length, params });
          }
          i = j + 1;
        } else {
          // Unterminated CSI (ran off the end): consume the rest, no event.
          i = n;
        }
        continue;
      }
      if (next === 0x5d) {
        // OSC: ESC ] ... (BEL | ST). Consume to terminator, drop.
        let j = i + 2;
        while (j < n) {
          const cj = rawE.charCodeAt(j);
          if (cj === 0x07) { j += 1; break; } // BEL
          if (cj === ESC && j + 1 < n && rawE.charCodeAt(j + 1) === 0x5c) { j += 2; break; } // ST
          j += 1;
        }
        i = j;
        continue;
      }
      if (next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f) {
        // DCS(P)/SOS(X)/PM(^)/APC(_): consume to ST (ESC \), drop.
        let j = i + 2;
        while (j < n) {
          if (rawE.charCodeAt(j) === ESC && j + 1 < n && rawE.charCodeAt(j + 1) === 0x5c) { j += 2; break; }
          j += 1;
        }
        i = j;
        continue;
      }
      // Other ESC-something (charset select `ESC(`, `ESC=`, lone ESC at EOF, …): drop 2 (or 1).
      i = next === -1 ? i + 1 : i + 2;
      continue;
    }

    // C1 controls (U+0080–U+009F): 8-bit escape forms — drop.
    if (c >= 0x80 && c <= 0x9f) { i += 1; continue; }
    // C0 controls except LF, and DEL — drop (the plain path shows none of these).
    if ((c < 0x20 && c !== LF) || c === 0x7f) { i += 1; continue; }

    // Ordinary text (incl. LF and multi-byte/surrogate code units).
    plain += rawE[i];
    i += 1;
  }

  return { plain, events };
}

// ── SGR state machine ─────────────────────────────────────────────────────────

type Color = number | { mode: 5; n: number } | { mode: 2; r: number; g: number; b: number };

interface SgrState {
  attrs: Set<number>; // simple on-attributes: 1,2,3,4,5,7,8,9,21
  fg: Color | null;
  bg: Color | null;
}

const emptyState = (): SgrState => ({ attrs: new Set(), fg: null, bg: null });

const stateEmpty = (s: SgrState): boolean => s.attrs.size === 0 && s.fg === null && s.bg === null;

const cloneState = (s: SgrState): SgrState => ({ attrs: new Set(s.attrs), fg: s.fg, bg: s.bg });

/** Split an SGR param string into numeric tokens, expanding colon sub-parameters. */
function sgrTokens(params: string): number[][] {
  // Semicolon separates parameters; a colon separates sub-parameters of one param
  // (extended color). We return groups so 38:5:n / 38:2:r:g:b arrive as one group,
  // while plain `1;31` arrives as [[1],[31]].
  if (params === '') return [[0]]; // ESC[m == ESC[0m (reset)
  return params.split(';').map((p) => p.split(':').map((t) => (t === '' ? 0 : Number(t))));
}

/** Apply one SGR parameter string to the state (mutates a clone; returns it). */
function applySgr(prev: SgrState, params: string): SgrState {
  const s = cloneState(prev);
  const groups = sgrTokens(params);
  // Flatten but remember colon-grouping: a colon group like [38,5,n] is self-contained.
  for (let gi = 0; gi < groups.length; gi += 1) {
    const g = groups[gi]!;
    const code = g[0]!;
    // Colon-form extended color: the whole sub-parameter list is in this group.
    if ((code === 38 || code === 48) && g.length >= 2) {
      const color = readColorFromGroup(g);
      if (code === 38) s.fg = color;
      else s.bg = color;
      continue;
    }
    // Semicolon-form extended color: 38/48 consumes following ';' tokens.
    if ((code === 38 || code === 48) && g.length === 1) {
      const mode = groups[gi + 1]?.[0];
      if (mode === 5 && groups[gi + 2] !== undefined) {
        const color: Color = { mode: 5, n: clamp255(groups[gi + 2]![0]!) };
        if (code === 38) s.fg = color; else s.bg = color;
        gi += 2;
        continue;
      }
      if (mode === 2 && groups[gi + 4] !== undefined) {
        const color: Color = { mode: 2, r: clamp255(groups[gi + 2]![0]!), g: clamp255(groups[gi + 3]![0]!), b: clamp255(groups[gi + 4]![0]!) };
        if (code === 38) s.fg = color; else s.bg = color;
        gi += 4;
        continue;
      }
      continue; // malformed extended color → ignore
    }
    applySimple(s, code);
  }
  return s;
}

function readColorFromGroup(g: number[]): Color | null {
  const mode = g[1];
  if (mode === 5 && g[2] !== undefined) return { mode: 5, n: clamp255(g[2]) };
  if (mode === 2) {
    // colon truecolor is 38:2:cs:r:g:b (color-space id at g[2]) OR 38:2:r:g:b.
    const off = g.length >= 6 ? 3 : 2;
    return { mode: 2, r: clamp255(g[off]!), g: clamp255(g[off + 1]!), b: clamp255(g[off + 2]!) };
  }
  return null;
}

const clamp255 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.trunc(v))) : 0);

function applySimple(s: SgrState, code: number): void {
  if (code === 0) { s.attrs.clear(); s.fg = null; s.bg = null; return; }
  if ((code >= 1 && code <= 9) || code === 21) { s.attrs.add(code); return; }
  if (code === 22) { s.attrs.delete(1); s.attrs.delete(2); return; }
  if (code === 23) { s.attrs.delete(3); return; }
  if (code === 24) { s.attrs.delete(4); s.attrs.delete(21); return; }
  if (code === 25) { s.attrs.delete(5); s.attrs.delete(6); return; }
  if (code === 27) { s.attrs.delete(7); return; }
  if (code === 28) { s.attrs.delete(8); return; }
  if (code === 29) { s.attrs.delete(9); return; }
  if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) { s.fg = code; return; }
  if (code === 39) { s.fg = null; return; }
  if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) { s.bg = code; return; }
  if (code === 49) { s.bg = null; return; }
  // anything else (unknown/unsupported) → ignore
}

/** Serialize the active state to a canonical `[0-9;]` param string ('' if none). */
function serializeSgr(s: SgrState): string {
  const parts: string[] = [];
  for (const a of [...s.attrs].sort((x, y) => x - y)) parts.push(String(a));
  pushColor(parts, s.fg, 38);
  pushColor(parts, s.bg, 48);
  return parts.join(';');
}

function pushColor(parts: string[], c: Color | null, ext: 38 | 48): void {
  if (c === null) return;
  if (typeof c === 'number') { parts.push(String(c)); return; }
  if (c.mode === 5) { parts.push(`${ext};5;${c.n}`); return; }
  parts.push(`${ext};2;${c.r};${c.g};${c.b}`);
}

// ── style re-map (plain runs → redacted, per-line spans) ────────────────────────

interface Run { start: number; end: number; sgr: string } // plain (global) offsets

/** Turn ordered SGR events into maximal constant-style runs over the plain text. */
function buildRuns(plainLen: number, events: SgrEvent[]): Run[] {
  const runs: Run[] = [];
  let state = emptyState();
  let segStart = 0;
  let curSgr = '';
  const boundaries = [...events, { offset: plainLen, params: '' } as SgrEvent];
  for (const ev of boundaries) {
    if (ev.offset > segStart && curSgr !== '') {
      const last = runs[runs.length - 1];
      if (last !== undefined && last.end === segStart && last.sgr === curSgr) last.end = ev.offset;
      else runs.push({ start: segStart, end: ev.offset, sgr: curSgr });
    }
    if (ev.offset >= plainLen) break;
    state = applySgr(state, ev.params);
    curSgr = stateEmpty(state) ? '' : serializeSgr(state);
    segStart = ev.offset;
  }
  return runs;
}

const REDACTED_TOKEN_RE = /\[REDACTED:[a-z-]+\]/g;

/**
 * Map plain-space `runs` onto the redacted text and split them into per-line spans.
 * Alignment: the preserved (non-redacted) segments are byte-identical in plain and
 * redacted, so we two-pointer them; runs are intersected with preserved segments,
 * which structurally clips them at `[REDACTED:*]` token edges (a run inside a
 * redacted region is dropped). Returns null on any alignment/validation failure →
 * caller falls back to plain (no spans).
 */
export function remapSpans(plain: string, redactedText: string, runs: Run[]): StyleSpan[][] | null {
  // 1) preserved segments between/around [REDACTED:*] tokens, in redacted coords.
  const preserved: { redStart: number; plainStart: number; len: number }[] = [];
  let redCursor = 0;
  let plainPtr = 0;
  REDACTED_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const addPreserved = (redStart: number, redEnd: number): boolean => {
    const text = redactedText.slice(redStart, redEnd);
    if (text.length === 0) return true;
    const plainStart = plain.indexOf(text, plainPtr);
    if (plainStart === -1) return false; // alignment broke → bail (plain fallback)
    preserved.push({ redStart, plainStart, len: text.length });
    plainPtr = plainStart + text.length;
    return true;
  };
  while ((m = REDACTED_TOKEN_RE.exec(redactedText)) !== null) {
    if (!addPreserved(redCursor, m.index)) return null;
    redCursor = m.index + m[0].length;
  }
  if (!addPreserved(redCursor, redactedText.length)) return null;

  // 2) translate runs (plain coords) → redacted coords, clipped to preserved segments.
  const redRuns: Run[] = [];
  for (const run of runs) {
    for (const seg of preserved) {
      const pStart = seg.plainStart;
      const pEnd = seg.plainStart + seg.len;
      const lo = Math.max(run.start, pStart);
      const hi = Math.min(run.end, pEnd);
      if (lo < hi) redRuns.push({ start: seg.redStart + (lo - pStart), end: seg.redStart + (hi - pStart), sgr: run.sgr });
    }
  }
  redRuns.sort((a, b) => a.start - b.start);

  // 3) split redacted-coord runs into per-line spans (offsets local to lines[i]).
  const lines = redactedText.split('\n');
  const spans: StyleSpan[][] = lines.map(() => []);
  const lineStart: number[] = [];
  let acc = 0;
  for (const line of lines) { lineStart.push(acc); acc += line.length + 1; } // +1 for the '\n'
  for (const run of redRuns) {
    // locate the line containing run.start (runs never span a token, but may span '\n').
    for (let li = 0; li < lines.length; li += 1) {
      const ls = lineStart[li]!;
      const le = ls + lines[li]!.length; // exclusive of the '\n'
      const lo = Math.max(run.start, ls);
      const hi = Math.min(run.end, le);
      if (lo < hi) {
        const arr = spans[li]!;
        const s = lo - ls;
        const e = hi - ls;
        const last = arr[arr.length - 1];
        if (last !== undefined && last.end === s && last.sgr === run.sgr) last.end = e;
        else arr.push({ start: s, end: e, sgr: run.sgr });
      }
    }
  }

  // 4) validate the wire invariants; any violation → plain fallback (null).
  for (const arr of spans) {
    if (arr.length > MAX_SPANS_PER_LINE) return null;
    let prevEnd = -1;
    for (const sp of arr) {
      if (!(sp.start >= 0 && sp.start < sp.end)) return null;
      if (sp.start < prevEnd) return null; // overlap / not sorted
      if (!SGR_RE.test(sp.sgr)) return null;
      prevEnd = sp.end;
    }
  }
  return spans;
}

/** Build the styled overlay for already-redacted `lines`, or null → plain fallback. */
export function buildStyledSpans(plain: string, events: SgrEvent[], lines: string[]): StyleSpan[][] | null {
  const runs = buildRuns(plain.length, events);
  if (runs.length === 0) return lines.map(() => []); // no styling → empty (still valid overlay)
  return remapSpans(plain, lines.join('\n'), runs);
}
