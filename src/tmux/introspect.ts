/**
 * SPEC-002 §2.9 — read-only process **subtree** introspection via a SINGLE `ps`
 * process-table snapshot (supersedes the per-pid `ps -o command= -p <pid>` of §2.8).
 *
 * `makeProcessSnapshot(spawn)` builds a {@link ProcessSnapshotFn} that issues ONE
 * read-only `ps` call for the whole process table (raw `{pid, ppid, argv}` rows).
 * The inventory collector then builds each pane's subtree in-memory by walking
 * `ppid` links from `pane_pid` ({@link buildSubtree}) — so the `ps` spawn count is
 * O(1) regardless of pane count (perf bound, AC-21), and the agent-bearing argv of
 * a wrapper chain (`zsh → claude → npm → node`) is visible even when it is not the
 * pane's foreground process (recall, AC-18).
 *
 * Safety contract (SPEC-002 §2.9 / SPEC-006 §2.7, D-019/D-020):
 *  - read-only: only ever `ps` with a fixed `-o pid=,ppid=,etimes=,command=` (or `args=`)
 *    projection (never a state-changing cmd). `etimes` (elapsed seconds, NON-SENSITIVE
 *    start-time) powers SPEC-302 §3.7 uptime; it precedes the spaces-bearing argv column.
 *  - fixed argv + shell-free: no user text is interpolated; the injected
 *    {@link ProcessSpawn} enforces `shell:false`.
 *  - per-call timeout: delegated to the injected spawn via `{ timeoutMs }`.
 *  - fail-closed & NEVER throws: any failure (spawn error, timeout, non-zero exit,
 *    empty/garbled output) degrades to `null` → every pane's `processTree` is null.
 *
 * RAW argv is returned here; the inventory collector applies the single `redact()`
 * chokepoint (SPEC-006 §2.7) to EACH subtree node before any consumer sees it.
 */
import type {
  ProcessSnapshotEntry,
  ProcessSnapshotFn,
  ProcessSpawn,
  SpawnResult,
} from '../types';
import { TMUX_TIMEOUT_MS } from '../types';

/** A pid is usable only if it is a finite, positive integer. */
function isValidPid(pid: number | null | undefined): pid is number {
  return pid !== null && pid !== undefined && Number.isInteger(pid) && pid > 0;
}

/**
 * Fixed, read-only `ps` argv for a whole-process-table snapshot. Platform-detected:
 *  - linux: `ps -eo pid=,ppid=,etimes=,args=` (full argv via `args`; `etimes`=elapsed seconds)
 *  - darwin/bsd: `ps -axo pid=,ppid=,etime=,command=` (full argv via `command`)
 * NOTE: `etimes` (raw seconds) is a Linux/procps keyword; **macOS/BSD `ps` only has `etime`**
 * (formatted `[[dd-]hh:]mm:ss`) — using `etimes` on darwin makes ps reject the keyword and
 * shift the columns. The elapsed column precedes the spaces-bearing command/args so the argv
 * column stays the line tail. Each line: `<pid> <ppid> <elapsed> <argv...>` (no header, `=`).
 * The elapsed column is NON-SENSITIVE (process start time, not content) → uptime (SPEC-302 §3.7).
 */
export function psSnapshotArgs(platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'linux'
    ? ['-eo', 'pid=,ppid=,etimes=,args=']
    : ['-axo', 'pid=,ppid=,etime=,command=']; // darwin + other BSDs (etime, not etimes)
}

/**
 * Parse a ps elapsed-time token to integer seconds. Accepts BOTH forms (so one parser serves
 * linux `etimes` and darwin `etime`): a bare integer (raw seconds), or `[[dd-]hh:]mm:ss`.
 * Returns null for anything else (→ etimeSec absent, fail-safe).
 */
export function parseElapsedSec(tok: string): number | null {
  if (/^\d+$/.test(tok)) {
    const n = Number.parseInt(tok, 10);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(tok); // [[dd-]hh:]mm:ss
  if (!m) return null;
  const dd = m[1] ? Number.parseInt(m[1], 10) : 0;
  const hh = m[2] ? Number.parseInt(m[2], 10) : 0;
  const mm = Number.parseInt(m[3]!, 10);
  const ss = Number.parseInt(m[4]!, 10);
  const sec = ((dd * 24 + hh) * 60 + mm) * 60 + ss;
  return Number.isInteger(sec) && sec >= 0 ? sec : null;
}

/**
 * Parse `ps` snapshot stdout into raw entries (pure). Each line is
 * `<leading ws?><pid> <ppid> <etimes> <argv with spaces>`. Lines that do not start with two
 * integer columns followed by an elapsed-seconds token + argv are skipped (robust to
 * stray/garbled rows). `etimes` is integer seconds; a non-integer etimes is treated as
 * ABSENT (the row is kept without `etimeSec`) — never throws. Returns [] for empty.
 */
export function parsePsSnapshot(stdout: string): ProcessSnapshotEntry[] {
  const out: ProcessSnapshotEntry[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number.parseInt(m[1]!, 10);
    const ppid = Number.parseInt(m[2]!, 10);
    const etimesRaw = m[3]!;
    const command = m[4]!;
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const entry: ProcessSnapshotEntry = { pid, ppid, command };
    // elapsed: linux `etimes` (raw seconds) OR darwin `etime` (`[[dd-]hh:]mm:ss`). Malformed →
    // absent (fail-safe), never throw.
    const sec = parseElapsedSec(etimesRaw);
    if (sec != null) entry.etimeSec = sec;
    out.push(entry);
  }
  return out;
}

/** Raw subtree node (pre-redaction): a process-table entry annotated with depth. */
export interface RawSubtreeNode {
  pid: number;
  ppid: number;
  depth: number; // pane_pid = 0, direct child = 1, …
  command: string; // RAW argv (collector redacts at the boundary)
  etimeSec?: number; // elapsed seconds (ps `etimes`); absent when unavailable (SPEC-302 §3.7)
}

/**
 * Build the subtree rooted at `panePid` (self + descendants) from a flat snapshot,
 * assigning depth (pane_pid = 0). Pure & deterministic: nodes are returned ordered
 * by `depth` then `pid` (SPEC-003 §3.4 determinism). Cycle-safe (visited set).
 *
 * Returns `[]` when `panePid` is invalid or absent from the snapshot (pane_pid not
 * alive) — distinct from a `null` snapshot (introspection unavailable).
 */
export function buildSubtree(
  entries: ProcessSnapshotEntry[],
  panePid: number | null | undefined,
): RawSubtreeNode[] {
  if (!isValidPid(panePid)) return [];
  const byPid = new Map<number, ProcessSnapshotEntry>();
  const childrenByPpid = new Map<number, ProcessSnapshotEntry[]>();
  for (const e of entries) {
    byPid.set(e.pid, e);
    const list = childrenByPpid.get(e.ppid);
    if (list) list.push(e);
    else childrenByPpid.set(e.ppid, [e]);
  }
  const root = byPid.get(panePid);
  if (!root) return [];

  const result: RawSubtreeNode[] = [];
  const visited = new Set<number>();
  const queue: Array<{ entry: ProcessSnapshotEntry; depth: number }> = [
    { entry: root, depth: 0 },
  ];
  while (queue.length > 0) {
    const { entry, depth } = queue.shift()!;
    if (visited.has(entry.pid)) continue;
    visited.add(entry.pid);
    result.push({
      pid: entry.pid,
      ppid: entry.ppid,
      depth,
      command: entry.command,
      ...(entry.etimeSec !== undefined ? { etimeSec: entry.etimeSec } : {}),
    });
    for (const child of childrenByPpid.get(entry.pid) ?? []) {
      if (child.pid !== entry.pid) queue.push({ entry: child, depth: depth + 1 });
    }
  }
  result.sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : a.pid - b.pid));
  return result;
}

/**
 * Construct a read-only single-snapshot `ps` introspection function (SPEC-002 §2.9).
 *
 * @param spawn      hardened spawn primitive (shell:false, fixed argv, timeout)
 * @param timeoutMs  per-call timeout (defaults to the tmux per-command budget)
 * @param platform   for argv selection (defaults to the host platform)
 */
export function makeProcessSnapshot(
  spawn: ProcessSpawn,
  timeoutMs: number = TMUX_TIMEOUT_MS,
  platform: NodeJS.Platform = process.platform,
): ProcessSnapshotFn {
  const args = psSnapshotArgs(platform);
  return async (): Promise<ProcessSnapshotEntry[] | null> => {
    let result: SpawnResult;
    try {
      result = await spawn('ps', args, { timeoutMs });
    } catch {
      return null; // injected spawn is hardened; never propagate
    }
    if (result.timedOut || result.spawnError !== null || result.exitCode !== 0) {
      return null; // fail-closed
    }
    const entries = parsePsSnapshot(result.stdout);
    return entries.length > 0 ? entries : null; // empty/garbled → treat as unavailable
  };
}
