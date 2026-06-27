/**
 * SPEC-006 §2.1 / §2.3 / §3.3 — the single redaction chokepoint (D-016).
 *
 * `redact()` is the ONE function every free-text field passes through before any
 * consumer (detection, status, preview, table, --json, debug log) sees it. It is
 * used for capture text, paneTitle, cmdline AND cwd (AC-17): cwd path components
 * that are not secrets are preserved while embedded secrets are masked.
 *
 * `sanitizeCapture()` is the multi-line capture pipeline: tail-preserving byte
 * clamp BEFORE redaction, one redaction pass over the clamped buffer, then split
 * into lines (oldest → newest). The raw argument is never retained or logged.
 *
 * Both functions are pure (deterministic in their input). Module-level regexes
 * carry the global flag; `String.prototype.replace` resets `lastIndex` per call,
 * so reuse across calls stays deterministic.
 */
import type { RedactionResult, SanitizedCapture } from '../types';
import { BYTE_CAP } from '../types';
import { REDACTION_RULES } from './patterns';

/**
 * Apply the full RP-01..RP-10 catalog in priority order, counting substitutions.
 *
 * @param text any free-text value (capture line buffer, paneTitle, cmdline, cwd)
 * @returns redacted text + whether anything matched + a substitution count
 *          (`matchCount` is a test-harness / debug-log metric only — SPEC-006
 *          §3.5 ④; it is NOT serialized to the wire).
 */
export function redact(text: string): RedactionResult {
  let out = text;
  let matchCount = 0;
  for (const rule of REDACTION_RULES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out = out.replace(rule.regex, (...args: any[]): string => {
      matchCount += 1;
      return rule.replace(...args);
    });
  }
  return { text: out, redacted: matchCount > 0, matchCount };
}

/** UTF-8 byte length of a string. */
function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Clamp `s` to at most `cap` bytes, KEEPING THE TAIL (the newest output). Any
 * leading UTF-8 continuation bytes left by the cut are dropped so a broken
 * multi-byte character is never emitted.
 */
function clampBytesTail(s: string, cap: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= cap) return s;
  let start = buf.length - cap;
  while (start < buf.length) {
    const byte = buf[start];
    // 0b10xxxxxx => UTF-8 continuation byte; advance to the next lead byte.
    if (byte === undefined || (byte & 0xc0) !== 0x80) break;
    start += 1;
  }
  return buf.subarray(start).toString('utf8');
}

/**
 * Capture sanitize pipeline (SPEC-006 §2.1 / §3.3):
 *   1. tail-preserving byte clamp to BYTE_CAP (BEFORE redaction)
 *   2. one `redact()` pass over the clamped buffer
 *   3. split on LF into `lines` (oldest → newest)
 *
 * `byteClamped` is true iff clamping actually dropped bytes. `raw` is not
 * retained anywhere after this call returns.
 */
export function sanitizeCapture(raw: string): SanitizedCapture {
  const byteClamped = utf8ByteLength(raw) > BYTE_CAP;
  const clamped = byteClamped ? clampBytesTail(raw, BYTE_CAP) : raw;
  const { text, redacted, matchCount } = redact(clamped);
  const lines = text.split('\n');
  return { lines, redacted, byteClamped, matchCount };
}
