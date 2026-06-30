/**
 * SPEC-008 usage-collection fixtures — synthetic Claude Code session JSONL + temp-root helpers.
 * Fully offline: NO dependency on a live ~/.claude (SPEC-008 §6 / SPEC-007). Secrets are
 * placeholder token shapes only (SPEC-000); the unique MARKER_* strings are planted on the SAME
 * lines as usage so the non-leak tests (AC-02) can assert NONE of them survive into any output.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeCwd } from '../../../src/usage/providers/claude-code';

// Placeholder secrets — token SHAPES only, never real credentials (SPEC-000 / SPEC-006 §2.2).
export const FAKE_GH_TOKEN = 'ghp_PLACEHOLDERLEAK0123456789abcdefghij';
export const FAKE_API_KEY = 'sk-ant-PLACEHOLDERLEAK0123456789abcdefghij';

// Unique, improbable markers planted in transcript content/tool-IO/paths on usage-bearing lines.
export const MARKER_BODY = 'ZZMARKERBODYxENGINEERINGSECRETxDONOTLEAKZZ';
export const MARKER_TOOL = 'ZZMARKERTOOLIOxDONOTLEAKZZ';
export const MARKER_CWD = 'ZZMARKERCWDPATHxDONOTLEAKZZ';
export const MARKER_BRANCH = 'ZZMARKERGITBRANCHxDONOTLEAKZZ';

export interface ClaudeUsageLineSpec {
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
  model?: string;
  timestamp?: string;
  /** Extra content text to plant on the line (defaults to a marker+secret payload). */
  content?: string;
}

/**
 * One Claude Code JSONL event line: a `message.usage` block (the numbers we WANT) co-located on
 * the same line with `cwd`, `gitBranch`, and full `message.content` carrying markers + fake
 * secrets (the content we must NEVER read). Mirrors the real layout in SPEC-008 §3.1.
 */
export function claudeLine(spec: ClaudeUsageLineSpec = {}): string {
  const content =
    spec.content ??
    `assistant turn ${MARKER_BODY} ran tool ${MARKER_TOOL} and printed token ${FAKE_GH_TOKEN} key ${FAKE_API_KEY}`;
  const obj = {
    type: 'assistant',
    cwd: `/home/user/${MARKER_CWD}`,
    gitBranch: `feature/${MARKER_BRANCH}`,
    sessionId: 'fixture-session',
    timestamp: spec.timestamp ?? '2026-06-29T12:00:00.000Z',
    message: {
      role: 'assistant',
      model: spec.model ?? 'claude-sonnet-4-6',
      content,
      usage: {
        input_tokens: spec.input ?? 1000,
        output_tokens: spec.output ?? 500,
        cache_creation_input_tokens: spec.cacheCreation ?? 0,
        cache_read_input_tokens: spec.cacheRead ?? 0,
      },
    },
  };
  return JSON.stringify(obj);
}

/** A non-usage event line (user message) — should contribute no tokens. */
export function userLine(): string {
  return JSON.stringify({
    type: 'user',
    cwd: `/home/user/${MARKER_CWD}`,
    timestamp: '2026-06-29T11:59:00.000Z',
    message: { role: 'user', content: `please ${MARKER_BODY}` },
  });
}

export function makeClaudeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'orc-usage-claude-'));
}

export function makeTmpDir(prefix = 'orc-usage-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Write `<root>/<encodeCwd(cwd)>/<sessionId>.jsonl` with the given lines; returns the file path. */
export function writeSession(
  root: string,
  cwd: string,
  sessionId: string,
  lines: string[],
): string {
  const dir = join(root, encodeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

/** Ensure the encoded-cwd directory exists (without writing any session file). Returns the dir. */
export function sessionDir(root: string, cwd: string): string {
  const dir = join(root, encodeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Current uid (tests inject this so ownership checks are deterministic). */
export const CURRENT_UID =
  typeof process.getuid === 'function' ? process.getuid() : -1;
