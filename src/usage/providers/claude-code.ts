/**
 * SPEC-008 §3.1/§4.4 — Claude Code usage provider.
 *
 * Reads Claude Code session JSONL under the FIXED root `~/.claude/projects/<encoded-cwd>/`.
 * Each line is a full event whose `message.usage` carries the billable token counts and whose
 * top-level `timestamp` is the event time. The line ALSO carries `cwd`, `gitBranch`, and the
 * entire `message.content` (conversation text, tool I/O, code, secrets) — so this parser is
 * strictly key-addressed: it binds ONLY `message.usage.{input_tokens,output_tokens,cache_*}`,
 * `message.model` (internal cost lookup only), and `timestamp`. `message.content`/`cwd`/
 * `gitBranch` are never read into a variable, returned, logged, cached, or serialized
 * (G1/AC-01, AC-02). The transient parsed object is discarded per line (non-storage, AC-03).
 *
 * Correlation (§4.2/§4.3, AC-07/AC-08): explicit session-id from the redaction-bound processTree
 * argv first (exact file → no ambiguity); else the single `*.jsonl` in the cwd-encoded directory;
 * else null. Multiple candidates with no explicit id → null (never guess → no misattribution).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OrcUsage, UsageLocateHint } from '../../types';
import type { ConfinedReader } from '../reader';
import { isIso8601, isNum, numOrZero, type UsageProvider } from '../provider';
import { estimateCostUsd, type ModelTokenTotals } from '../cost';

export const CLAUDE_PROJECTS_SUBPATH = ['.claude', 'projects'] as const;

export function defaultClaudeRoot(home: string = homedir()): string {
  return join(home, ...CLAUDE_PROJECTS_SUBPATH);
}

/**
 * Encode an absolute cwd to Claude Code's project-directory name. Observed rule: path separators
 * and dots are replaced by `-` (e.g. `/Users/me/app.v2` → `-Users-me-app-v2`). Provider-internal
 * and version-sensitive (Q6) — isolated here; a mismatch simply means the directory isn't found
 * → null. Note: encoding `/`→`-` neutralizes any `..` traversal in the input.
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, '-');
}

// Match an explicit session-id flag followed by a UUID. Requires a UUID shape, so a non-uuid
// value (or a redaction placeholder) never matches — and a UUID has no path separators, so the
// derived `<id>.jsonl` filename cannot traverse. UUIDs survive SPEC-006 redaction (no key-ish
// `:`/`=` context), so they reach us intact via the redacted argv.
const SESSION_ID_RE =
  /(?:--session-id|--session|--resume)(?:[=\s]+)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/;

export function extractSessionId(commands: string[]): string | null {
  for (const cmd of commands) {
    const m = SESSION_ID_RE.exec(cmd);
    if (m) return m[1]!.toLowerCase();
  }
  return null;
}

function parseSessionFile(
  filePath: string,
  reader: ConfinedReader,
): OrcUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let records = 0;
  let lastTs: string | null = null;
  const perModel = new Map<string, ModelTokenTotals>();

  const stats = reader.readLines(filePath, (line) => {
    // Transient parse. We bind ONLY numeric usage fields + the timestamp; the rest of `obj`
    // (message.content, cwd, gitBranch, tool I/O) is never referenced and is GC'd with `obj`.
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // not JSON → skip this line (robust to adversarial/garbled lines, T-U08)
    }
    if (typeof obj !== 'object' || obj === null) return;
    const rec = obj as Record<string, unknown>;

    const message = rec['message'];
    if (typeof message === 'object' && message !== null) {
      const msg = message as Record<string, unknown>;
      const usage = msg['usage'];
      if (typeof usage === 'object' && usage !== null) {
        const u = usage as Record<string, unknown>;
        const inT = numOrZero(u['input_tokens']);
        const outT = numOrZero(u['output_tokens']);
        if (isNum(u['input_tokens']) || isNum(u['output_tokens'])) {
          inputTokens += inT;
          outputTokens += outT;
          records += 1;
          const model = typeof msg['model'] === 'string' ? (msg['model'] as string) : '';
          const acc =
            perModel.get(model) ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
          acc.input += inT;
          acc.output += outT;
          acc.cacheCreation += numOrZero(u['cache_creation_input_tokens']);
          acc.cacheRead += numOrZero(u['cache_read_input_tokens']);
          perModel.set(model, acc);
        }
      }
    }

    // Timestamp: ISO-8601-only (AC-01). A non-ISO value is ignored → mtime fallback.
    const ts = rec['timestamp'];
    if (isIso8601(ts)) lastTs = ts;
  });

  if (stats === null) return null; // confinement/ownership/open failure → null
  if (records === 0) return null; // no usage signal → unmeasured, not "0" (AC-07)

  // cumulativeTokens = input + output (cache tokens captured for cost but excluded from the
  // billable token count by default — SPEC-008 Q4).
  const cumulativeTokens = inputTokens + outputTokens;
  const cumulativeCostUsd = estimateCostUsd(perModel); // number | null (null if no known model)
  const measuredAt = lastTs ?? new Date(stats.mtimeMs).toISOString();

  // source = 'estimated': tokens come from the transcript, but cost is DERIVED from a price
  // table (Claude logs emit no explicit cost) — SPEC-008 §4.4.
  return { cumulativeTokens, cumulativeCostUsd, source: 'estimated', measuredAt };
}

export function makeClaudeCodeProvider(root: string = defaultClaudeRoot()): UsageProvider {
  return {
    id: 'claude-code',
    root,
    collect(hint: UsageLocateHint, reader: ConfinedReader): OrcUsage | null {
      // Single directory under the fixed root, derived from the (redacted) cwd. No $HOME walk.
      const dir = join(reader.root, encodeCwd(hint.cwd));

      // (1) Explicit session-id from argv → exact file. If it isn't there, do NOT guess — null.
      const explicitId = extractSessionId(hint.processTreeCommands);
      if (explicitId) {
        return parseSessionFile(join(dir, `${explicitId}.jsonl`), reader);
      }

      // (2) Single-recent: list the one directory; accept ONLY when exactly one *.jsonl exists.
      //     Zero or multiple (ambiguous) → null (no misattribution — AC-07c/AC-08).
      const names = reader.listDir(dir);
      if (names === null) return null;
      const jsonls = names.filter((n) => n.endsWith('.jsonl'));
      if (jsonls.length !== 1) return null;
      return parseSessionFile(join(dir, jsonls[0]!), reader);
    },
  };
}
