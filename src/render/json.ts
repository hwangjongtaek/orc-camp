/**
 * SPEC-001 §2.3 / SPEC-005 §3.4 — JSON serialization of a ScanResult.
 *
 * The assembler builds objects with a fixed key insertion order and pre-sorted
 * arrays, so `JSON.stringify` is byte-deterministic for a given input (SPEC-005
 * AC-13). Single-shot emits one compact JSON document; `--watch --json` emits one
 * compact JSON object per cycle (NDJSON, SPEC-001 §3.2) — compact form keeps both
 * paths `jq`-friendly.
 */
import { type ScanResult } from '../types';

/** Compact, deterministic single-line JSON for a scan result. */
export function toJsonLine(result: ScanResult): string {
  return JSON.stringify(result);
}
