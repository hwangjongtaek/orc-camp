/**
 * SPEC-103 §2.3.1 / SPEC-203 §2.4 — client-side SGR reassembly for the styled overlay (pure).
 *
 * The wire carries redacted plain `lines` + structured `spans` (never raw escape bytes). The
 * client's ONLY styled behavior is defined here: wrap each run's UNMODIFIED slice of `line` in
 * `ESC[<sgr>m … ESC[0m` (rule: between/outside runs the style is reset). Concatenating the
 * emitted slices reproduces `line` byte-identically — the text is never masked, reconstructed,
 * or reinterpreted (invariant ②); only finite, charset-checked SGR params are injected.
 *
 * Defense-in-depth: even though the server validates spans before emit, nothing is interpolated
 * into an escape sequence here without re-checking the §2.3.1 wire invariants (charset via
 * SGR_RE, bounds, sorted/non-overlapping, run cap). ANY violation renders the whole line plain —
 * the same fail-safe direction as the server's plain fallback, never a partially-trusted style.
 */
import { MAX_SPANS_PER_LINE, SGR_RE, type StyleSpan } from '../types/ws';

/** Reassemble one redacted line with its SGR overlay; any invalid span ⇒ the plain line. */
export function styleLine(line: string, spans: readonly StyleSpan[] | undefined): string {
  if (spans === undefined || spans.length === 0) return line;
  if (spans.length > MAX_SPANS_PER_LINE) return line;
  let out = '';
  let prevEnd = 0;
  for (const sp of spans) {
    if (!Number.isInteger(sp.start) || !Number.isInteger(sp.end)) return line;
    if (sp.start < prevEnd || sp.start >= sp.end || sp.end > line.length) return line; // unsorted/overlap/bounds
    if (typeof sp.sgr !== 'string' || !SGR_RE.test(sp.sgr)) return line; // charset/length (rule 3)
    out += line.slice(prevEnd, sp.start) + `\x1b[${sp.sgr}m` + line.slice(sp.start, sp.end) + '\x1b[0m';
    prevEnd = sp.end;
  }
  return out + line.slice(prevEnd);
}

/**
 * Apply the overlay to a full rendered buffer: `spans === null` (plain buffer) or a length
 * mismatch returns `lines` as-is (no copy), so the Phase 1 plain path stays zero-cost.
 */
export function styleLines(lines: readonly string[], spans: readonly StyleSpan[][] | null): readonly string[] {
  if (spans === null || spans.length !== lines.length) return lines;
  return lines.map((line, i) => styleLine(line, spans[i]));
}
