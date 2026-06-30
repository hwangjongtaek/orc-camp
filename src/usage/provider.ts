/**
 * SPEC-008 §4.4 — provider-pluggable usage extraction. A UsageProvider owns ONE provider's log
 * layout (root, file-naming, usage field addresses) and reads ONLY through the injected
 * ConfinedReader. The collector (collect.ts) dispatches by `agentType`; unknown → no provider →
 * null (G8). Adding a provider = implement this interface against a CODE-FIXED root (no
 * user-supplied path, PF-U02).
 */
import type { AgentType, OrcUsage, UsageLocateHint } from '../types';
import type { ConfinedReader } from './reader';

export interface UsageProvider {
  readonly id: AgentType;
  /** Code-fixed allowlist root for this provider (e.g. ~/.claude/projects). */
  readonly root: string;
  /**
   * Locate + parse this orc's session log via the confined reader; null on any doubt. SYNC —
   * the async open-handle (fd) correlation runs in the COLLECTOR, which pre-resolves the candidate
   * paths and passes them in. `openHandlePaths` are already filtered to ABSOLUTE, in-root,
   * `.jsonl` paths ([] when none/unavailable); the provider re-validates on read (SPEC-008 §4.2a).
   */
  collect(
    hint: UsageLocateHint,
    reader: ConfinedReader,
    openHandlePaths: string[],
  ): OrcUsage | null;
}

// ---------------------------------------------------------------------------
// Shared numeric / timestamp guards (keep content out of OrcUsage — G1/AC-01)
// ---------------------------------------------------------------------------

/** A finite, non-negative number from arbitrary JSON; anything else → 0. */
export function numOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** True iff `v` is an actual numeric token field (so an all-zero usage line still counts). */
export function isNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * ISO 8601 validator for `measuredAt`. Rejects free text so an attacker-controlled string in a
 * `timestamp` field can never become content in OrcUsage (AC-01). On reject the caller falls
 * back to the file mtime.
 */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

export function isIso8601(v: unknown): v is string {
  return typeof v === 'string' && ISO_8601.test(v);
}
