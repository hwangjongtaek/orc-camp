/**
 * Unit tests for the SPEC-006 §2.8 ANSI/styled redaction primitives
 * (src/redaction/ansi.ts) and the styled producer sanitizeStyledCapture
 * (src/redaction/redact.ts). Covers strip-ALL, SGR state serialization, the
 * spans-over-redacted-plain overlay, and the wire invariants (SPEC-103 §2.3.1).
 */
import { describe, expect, it } from 'vitest';
import { stripAnsi, buildStyledSpans } from '../../src/redaction/ansi';
import { redact, sanitizeStyledCapture } from '../../src/redaction/redact';
import { SGR_RE, MAX_SPANS_PER_LINE, type StyleSpan } from '../../src/server/live-view';
import { BYTE_CAP } from '../../src/types';

const ESC = '\x1b';
const TOKEN_RE = /\[REDACTED:[a-z-]+\]/g;

// ── structural assertions reused across cases ────────────────────────────────────

/** No span partially/wholly overlaps a [REDACTED:*] token, and runs are sorted+disjoint. */
function assertSpansWellFormed(lines: string[], spans: StyleSpan[][]): void {
  expect(spans.length).toBe(lines.length);
  lines.forEach((line, i) => {
    const arr = spans[i]!;
    expect(arr.length).toBeLessThanOrEqual(MAX_SPANS_PER_LINE);
    // token ranges on this line
    const tokens: [number, number][] = [];
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(line)) !== null) tokens.push([m.index, m.index + m[0].length]);
    let prevEnd = -1;
    for (const sp of arr) {
      expect(sp.start).toBeGreaterThanOrEqual(0);
      expect(sp.start).toBeLessThan(sp.end);
      expect(sp.end).toBeLessThanOrEqual(line.length);
      expect(sp.start).toBeGreaterThanOrEqual(prevEnd); // sorted, non-overlapping
      expect(SGR_RE.test(sp.sgr)).toBe(true); // charset [0-9;:], len ≤ SGR_MAX
      expect(sp.sgr).not.toContain(ESC);
      for (const [ts, te] of tokens) expect(sp.start >= te || sp.end <= ts).toBe(true); // no cross
      prevEnd = sp.end;
    }
  });
}

const noRawEscape = (lines: string[], spans: StyleSpan[][] | null): void => {
  for (const l of lines) expect(l).not.toContain(ESC);
  if (spans) for (const arr of spans) for (const s of arr) expect(s.sgr).not.toContain(ESC);
};

// ── stripAnsi ────────────────────────────────────────────────────────────────────

describe('stripAnsi (SPEC-006 §2.8 tokenize→strip-ALL)', () => {
  it('strips SGR and records an event at the plain offset', () => {
    const r = stripAnsi(`ab${ESC}[31mcd`);
    expect(r.plain).toBe('abcd');
    expect(r.events).toEqual([{ offset: 2, params: '31' }]);
  });

  it('strips non-SGR escapes (OSC / CSI cursor) with NO event', () => {
    expect(stripAnsi(`a${ESC}]0;title\x07b`).events).toEqual([]);
    expect(stripAnsi(`a${ESC}]0;title\x07b`).plain).toBe('ab');
    expect(stripAnsi(`a${ESC}[2Cb`).plain).toBe('ab'); // cursor-forward, final 'C'
    expect(stripAnsi(`a${ESC}[2Cb`).events).toEqual([]);
  });

  it('strips DCS/APC and C0/C1 controls but preserves LF and text', () => {
    expect(stripAnsi(`x${ESC}P1;2q body${ESC}\\y`).plain).toBe('xy'); // DCS ... ST
    expect(stripAnsi('a\x00b\x07c\nd').plain).toBe('abc\nd'); // NUL/BEL dropped, LF kept
    expect(stripAnsi('a\x9bb').plain).toBe('ab'); // lone C1 control (0x9b) dropped
  });

  it('malformed/private SGR (ESC[<..m, unterminated) yields no event, escape stripped', () => {
    expect(stripAnsi(`${ESC}[<31mX`).events).toEqual([]); // private-param `<` → not SGR
    expect(stripAnsi(`${ESC}[<31mX`).plain).toBe('X');
    expect(stripAnsi(`ab${ESC}[`).plain).toBe('ab'); // unterminated CSI at EOF
    expect(stripAnsi(`ab${ESC}[`).events).toEqual([]);
  });

  it('resyncs (does not drop the tail) on a control byte embedded in CSI params', () => {
    // ESC[31<BEL>m tail — non-final byte at the BEL; CSI discarded, tail survives.
    const r = stripAnsi(`x${ESC}[31\x07m tail`);
    expect(r.plain).toBe('xm tail'); // '31' params dropped, BEL dropped, 'm tail' kept
    expect(r.events).toEqual([]); // no SGR event (never saw a valid final 'm' for the params)
  });
});

// ── sanitizeStyledCapture: secret-recall == plain (T-13) ──────────────────────────

describe('sanitizeStyledCapture — styled-bypass blocked (SPEC-006 AC-20 / SPEC-103 AC-18)', () => {
  const j = (...p: string[]): string => p.join('');
  const GH = j('ghp_', 'A'.repeat(20), '1234');

  it('SGR inserted mid-token still redacts (secret-recall 1.0)', () => {
    const raw = `push ${GH.slice(0, 4)}${ESC}[31m${GH.slice(4)} ok`;
    const r = sanitizeStyledCapture(raw);
    const joined = r.lines.join('\n');
    expect(joined).not.toContain(GH);
    expect(joined).toContain('[REDACTED:github-token]');
    noRawEscape(r.lines, r.spans);
  });

  it('non-SGR escape inserted mid-token still redacts (strip-ALL)', () => {
    const raw = `push ${GH.slice(0, 4)}${ESC}]0;t\x07${GH.slice(4)} ok`;
    expect(sanitizeStyledCapture(raw).lines.join('\n')).not.toContain(GH);
    expect(sanitizeStyledCapture(raw).lines.join('\n')).toContain('[REDACTED:github-token]');
  });

  it('lines are byte-identical (element-wise) to redact(stripAll(raw)) — non-destructive overlay', () => {
    const raw = `${ESC}[32m${GH}${ESC}[0m tail`;
    const r = sanitizeStyledCapture(raw);
    // reference baseline via the same seams (redact(stripAll(raw)), element-wise)
    const { plain } = stripAnsi(raw);
    expect(r.lines).toEqual(redact(plain).text.split('\n'));
  });
});

// ── spans overlay correctness ─────────────────────────────────────────────────────

describe('sanitizeStyledCapture — spans overlay (SPEC-103 §2.3.1)', () => {
  it('colors a word with the accumulated SGR state', () => {
    const r = sanitizeStyledCapture(`${ESC}[1;31mERR${ESC}[0m ok`);
    expect(r.lines).toEqual(['ERR ok']);
    expect(r.spans).toEqual([[{ start: 0, end: 3, sgr: '1;31' }]]);
    assertSpansWellFormed(r.lines, r.spans!);
  });

  it('serializes truecolor fg+bg+bold within SGR_MAX and [0-9;]', () => {
    const r = sanitizeStyledCapture(`${ESC}[1;38;2;255;0;0;48;2;0;0;255mHI${ESC}[0m`);
    expect(r.spans).toEqual([[{ start: 0, end: 2, sgr: '1;38;2;255;0;0;48;2;0;0;255' }]]);
    assertSpansWellFormed(r.lines, r.spans!);
  });

  it('a span NEVER crosses a [REDACTED:*] token (clipped at edges)', () => {
    const j = (...p: string[]): string => p.join('');
    const GH = j('ghp_', 'A'.repeat(20), '1234');
    // color spans the whole line INCLUDING the secret; after redaction the styled run
    // must be clipped to the preserved text around the token.
    const r = sanitizeStyledCapture(`${ESC}[33mtoken ${GH} end${ESC}[0m`);
    expect(r.lines[0]).toContain('[REDACTED:github-token]');
    assertSpansWellFormed(r.lines, r.spans!);
    // the styled run does not touch the token interior
    const line = r.lines[0]!;
    const ti = line.indexOf('[REDACTED');
    for (const sp of r.spans![0]!) expect(sp.start >= ti + '[REDACTED:github-token]'.length || sp.end <= ti).toBe(true);
  });

  it('multi-line: spans are per-line and split at newlines', () => {
    const r = sanitizeStyledCapture(`${ESC}[31mA\nB${ESC}[0m`);
    expect(r.lines).toEqual(['A', 'B']);
    expect(r.spans).toEqual([[{ start: 0, end: 1, sgr: '31' }], [{ start: 0, end: 1, sgr: '31' }]]);
  });

  it('plain (no styling) → spans null (bandwidth: send plain)', () => {
    expect(sanitizeStyledCapture('nothing styled here').spans).toBeNull();
  });

  it('buildStyledSpans returns empty arrays when there are zero runs', () => {
    expect(buildStyledSpans('abc', [], ['abc'])).toEqual([[]]);
  });
});

// ── byte cap (T-10) ────────────────────────────────────────────────────────────────

describe('sanitizeStyledCapture — byte cap on the -e path (SPEC-006 §2.8 clamp-before-tokenize)', () => {
  it('clamps a >BYTE_CAP styled buffer, redacts the tail secret, emits no raw escape', () => {
    const j = (...p: string[]): string => p.join('');
    const GH = j('ghp_', 'B'.repeat(20), '5678');
    const head = `x${ESC}[32mG${ESC}[0m `.repeat(Math.ceil(BYTE_CAP / 6)); // > BYTE_CAP, escapes throughout
    const r = sanitizeStyledCapture(`${head}\ntoken ${GH}`);
    expect(r.byteClamped).toBe(true);
    expect(r.lines.join('\n')).not.toContain(GH);
    expect(r.lines.join('\n')).toContain('[REDACTED:github-token]');
    noRawEscape(r.lines, r.spans);
  });
});
