/**
 * SPEC-103 §2.3.1 / SPEC-203 §2.4 — client SGR reassembly of the styled overlay.
 * Fail-safe contract: ANY invalid span (charset, bounds, order, cap) renders the
 * whole line plain — never a partially-trusted style, never a modified text byte.
 */
import { describe, it, expect } from 'vitest';
import { styleLine, styleLines } from '../src/terminal/styledLine';
import type { StyleSpan } from '../src/types/ws';

const ESC = '\x1b';

describe('styleLine — SGR reassembly (§2.3.1 client render rule)', () => {
  it('wraps a single run in ESC[<sgr>m … ESC[0m', () => {
    expect(styleLine('error: boom', [{ start: 0, end: 5, sgr: '1;31' }])).toBe(
      `${ESC}[1;31merror${ESC}[0m: boom`,
    );
  });

  it('handles multiple runs with plain text between/around', () => {
    const spans: StyleSpan[] = [
      { start: 2, end: 4, sgr: '32' },
      { start: 6, end: 8, sgr: '38;5;204' },
    ];
    expect(styleLine('abcdefghij', spans)).toBe(
      `ab${ESC}[32mcd${ESC}[0mef${ESC}[38;5;204mgh${ESC}[0mij`,
    );
  });

  it('text bytes are preserved exactly (concat of emitted slices == line)', () => {
    const line = 'x [REDACTED:api-key] y';
    const styled = styleLine(line, [
      { start: 0, end: 2, sgr: '33' },
      { start: 20, end: 22, sgr: '33' },
    ]);
    // Stripping the injected escapes must reproduce the input byte-identically.
    expect(styled.replace(/\x1b\[[0-9;:]*m/g, '')).toBe(line);
  });

  it('no/empty spans → the plain line (identity)', () => {
    expect(styleLine('plain', undefined)).toBe('plain');
    expect(styleLine('plain', [])).toBe('plain');
  });

  it('invalid sgr charset (escape/letters/too long) → whole line plain', () => {
    expect(styleLine('abc', [{ start: 0, end: 1, sgr: '31m;evil' }])).toBe('abc');
    expect(styleLine('abc', [{ start: 0, end: 1, sgr: `${ESC}[31` }])).toBe('abc');
    expect(styleLine('abc', [{ start: 0, end: 1, sgr: '1;'.repeat(40) }])).toBe('abc'); // > SGR_MAX
    expect(styleLine('abc', [{ start: 0, end: 1, sgr: '' }])).toBe('abc');
  });

  it('out-of-bounds / inverted / overlapping / unsorted spans → whole line plain', () => {
    expect(styleLine('abc', [{ start: 1, end: 5, sgr: '31' }])).toBe('abc'); // end > length
    expect(styleLine('abc', [{ start: 2, end: 2, sgr: '31' }])).toBe('abc'); // empty run
    expect(
      styleLine('abcdef', [
        { start: 0, end: 3, sgr: '31' },
        { start: 2, end: 5, sgr: '32' }, // overlaps the first
      ]),
    ).toBe('abcdef');
    expect(
      styleLine('abcdef', [
        { start: 3, end: 5, sgr: '31' },
        { start: 0, end: 2, sgr: '32' }, // not sorted by start
      ]),
    ).toBe('abcdef');
    expect(styleLine('abc', [{ start: 0.5 as number, end: 2, sgr: '31' }])).toBe('abc');
  });

  it('run cap: more than MAX_SPANS_PER_LINE runs → plain', () => {
    const line = 'x'.repeat(600);
    const spans: StyleSpan[] = Array.from({ length: 257 }, (_, i) => ({
      start: i * 2,
      end: i * 2 + 1,
      sgr: '31',
    }));
    expect(styleLine(line, spans)).toBe(line);
  });
});

describe('styleLines — buffer-level overlay', () => {
  it('null overlay (plain buffer) returns lines as-is', () => {
    const lines = ['a', 'b'];
    expect(styleLines(lines, null)).toBe(lines); // same reference: zero-cost plain path
  });

  it('length mismatch → plain (fail-safe)', () => {
    const lines = ['a', 'b'];
    expect(styleLines(lines, [[{ start: 0, end: 1, sgr: '31' }]])).toBe(lines);
  });

  it('per-line application with [] = unstyled line', () => {
    const out = styleLines(['ab', 'cd'], [[], [{ start: 0, end: 2, sgr: '4;36' }]]);
    expect(out).toEqual(['ab', `${ESC}[4;36mcd${ESC}[0m`]);
  });
});
