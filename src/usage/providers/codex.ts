/**
 * SPEC-008 §4.4 / Open Question Q1 — Codex usage provider STUB.
 *
 * Codex session logs live under `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`, but the
 * usage-payload key shape is NOT yet empirically confirmed (Q1). Per the contract, until the
 * keys are verified this provider returns `null` rather than guess (guessing risks both
 * misattribution and parsing the wrong field). The root is deliberately scoped to `sessions/`
 * ONLY — the sibling `~/.codex/{auth.json,.env,config.toml}` are secrets and are NEVER in scope
 * (§3.1/§4.2). The collector + ConfinedReader confinement are already wired, so implementing
 * this is a matter of locating the rollout file and adding the key-addressed numeric extraction
 * exactly as the Claude provider does — no new file-access surface.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OrcUsage, UsageLocateHint } from '../../types';
import type { ConfinedReader } from '../reader';
import type { UsageProvider } from '../provider';

export const CODEX_SESSIONS_SUBPATH = ['.codex', 'sessions'] as const;

export function defaultCodexRoot(home: string = homedir()): string {
  return join(home, ...CODEX_SESSIONS_SUBPATH);
}

export function makeCodexProvider(root: string = defaultCodexRoot()): UsageProvider {
  return {
    id: 'codex',
    root,
    collect(_hint: UsageLocateHint, _reader: ConfinedReader): OrcUsage | null {
      // STUB (Q1): usage-payload keys unverified → return null (no guessing).
      return null;
    },
  };
}
