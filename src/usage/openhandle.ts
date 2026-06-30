/**
 * SPEC-008 §4.2a — open-handle (fd) correlation. The THIRD read-only inspection boundary (after
 * tmux and `ps`): it looks at which files a pane's OWN agent subtree currently holds OPEN and
 * returns ONLY those that land under the provider's fixed root and end in `.jsonl`. Because an
 * agent appends to its session JSONL, that file is open — so a process's open fd set points at
 * the session log deterministically (no mtime guessing → no misattribution, AC-12).
 *
 * Over-disclosure is structurally blocked (T-U10 / AC-13): every other open path (other-project
 * files, secrets, sockets, pipes) is matched against `root + .jsonl` and discarded UNREAD — never
 * realpath-opened beyond the containment check, never retained past this function, never logged.
 *
 *  - darwin: `lsof -n -P -b -w -F n -p <pid>` per pid — fixed argv, shell:false (the injected
 *    spawn enforces it), `-n -P` so there is NO reverse-DNS / network side effect, `-F n` so only
 *    `n<path>` field lines are read. lsof missing / denied / timeout / non-zero → that pid is
 *    skipped (this whole step degrades to []).
 *  - linux: read `/proc/<pid>/fd` (no subprocess) and `readlink` each entry for its TARGET PATH
 *    STRING only — the target is NEVER opened/followed. EACCES (other uid) / ENOENT → skip.
 *
 * NEVER throws: any error or an unsupported platform resolves to []. Read-only throughout.
 */
import {
  readdirSync as fsReaddirSync,
  readlinkSync as fsReadlinkSync,
  realpathSync as fsRealpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { USAGE_TIME_BUDGET_MS, type ProcessSpawn } from '../types';
import { isUnderRoot } from './reader';

/** Resolve pane-subtree pids → absolute, in-root, `.jsonl` open-handle paths (deduped). */
export type OpenHandleLocator = (pids: number[], rootReal: string) => Promise<string[]>;

/** Bounds (over-disclosure / DoS guards). */
const MAX_PIDS = 16; // subtree pids actually inspected per call
const MAX_PATHS_PER_PID = 4096; // n-lines (darwin) / fd entries (linux) handled per pid

/** Injectable seams so the platform branches are unit-testable without a live host. */
export interface OpenHandleOptions {
  platform?: NodeJS.Platform;
  realpathSync?: (p: string) => string;
  readdirSync?: (p: string) => string[];
  readlinkSync?: (p: string) => string;
  maxPids?: number;
  /** Per-`lsof`-call wall-clock (reuse the read budget scale). */
  timeoutMs?: number;
}

export function makeOpenHandleLocator(
  spawn: ProcessSpawn,
  opts: OpenHandleOptions = {},
): OpenHandleLocator {
  const platform = opts.platform ?? process.platform;
  const realpathSync = opts.realpathSync ?? fsRealpathSync;
  const readdirSync = opts.readdirSync ?? fsReaddirSync;
  const readlinkSync = opts.readlinkSync ?? fsReadlinkSync;
  const maxPids = opts.maxPids ?? MAX_PIDS;
  const timeoutMs = opts.timeoutMs ?? USAGE_TIME_BUDGET_MS;

  /**
   * Keep a raw open-handle path ONLY if it realpaths under the fixed root AND ends in `.jsonl`.
   * Anything else is dropped here, unread (the realpath is the only fs touch, and it does not
   * open the file). Stores the canonical (realpath'd) absolute path; the reader re-validates.
   */
  function keepIfInRoot(rootReal: string, rawPath: string, out: Set<string>): void {
    if (!rawPath || !rawPath.endsWith('.jsonl')) return; // cheap reject before any fs call
    let real: string;
    try {
      real = realpathSync(rawPath);
    } catch {
      return; // gone / broken symlink / denied → skip (never read)
    }
    if (!real.endsWith('.jsonl')) return;
    if (!isUnderRoot(rootReal, real)) return; // escapes the fixed root → discard
    out.add(real);
  }

  async function fromLsof(pids: number[], rootReal: string, out: Set<string>): Promise<void> {
    for (const pid of pids) {
      let res;
      try {
        // Fixed argv; the injected spawn is shell:false with a per-call timeout.
        res = await spawn(
          'lsof',
          ['-n', '-P', '-b', '-w', '-F', 'n', '-p', String(pid)],
          { timeoutMs },
        );
      } catch {
        continue; // spawn never throws, but guard regardless
      }
      if (!res || res.spawnError || res.timedOut) continue; // lsof missing/denied/timeout → skip pid
      const lines = res.stdout.split('\n');
      const limit = Math.min(lines.length, MAX_PATHS_PER_PID);
      for (let i = 0; i < limit; i++) {
        const line = lines[i]!;
        if (line.charCodeAt(0) !== 110 /* 'n' */) continue; // only `n<path>` field lines
        keepIfInRoot(rootReal, line.slice(1), out);
      }
    }
  }

  function fromProc(pids: number[], rootReal: string, out: Set<string>): void {
    for (const pid of pids) {
      const fdDir = `/proc/${pid}/fd`;
      let entries: string[];
      try {
        entries = readdirSync(fdDir);
      } catch {
        continue; // other-uid (EACCES) / gone (ENOENT) → fail-closed skip
      }
      const limit = Math.min(entries.length, MAX_PATHS_PER_PID);
      for (let i = 0; i < limit; i++) {
        let target: string;
        try {
          target = readlinkSync(join(fdDir, entries[i]!)); // path STRING only; never open the target
        } catch {
          continue; // EACCES / ENOENT → skip
        }
        keepIfInRoot(rootReal, target, out);
      }
    }
  }

  return async (pids: number[], rootReal: string): Promise<string[]> => {
    try {
      if (!rootReal || !Array.isArray(pids) || pids.length === 0) return [];
      const valid = pids.filter((p) => Number.isInteger(p) && p > 0).slice(0, maxPids);
      if (valid.length === 0) return [];
      const out = new Set<string>();
      if (platform === 'darwin') {
        await fromLsof(valid, rootReal, out);
      } else if (platform === 'linux') {
        fromProc(valid, rootReal, out);
      } else {
        return []; // unsupported platform → degrade
      }
      return [...out];
    } catch {
      return []; // NEVER throws
    }
  };
}
