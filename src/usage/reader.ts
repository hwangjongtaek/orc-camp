/**
 * SPEC-008 §4.2 — the ConfinedReader: the SINGLE file-access boundary for the usage read
 * surface. Every session-log byte the usage collector ever touches passes through here, and
 * this is the only place in the codebase that opens a file outside the tmux/ps surfaces.
 *
 * Security contract (G4/G5, SPEC-008-AC-04/05/06/11):
 *  - root confinement: a candidate path is realpath-normalized and asserted to stay under a
 *    CODE-FIXED allowlist root; a symlink that escapes the root is refused BEFORE any read
 *    (its target is never opened) — AC-04.
 *  - ownership + regular-file: the OPEN fd is fstat'd; `st_uid !== getuid()` or a non-regular
 *    file is refused and not read — AC-05.
 *  - read-only + TOCTOU-safe: opened O_RDONLY | O_NOFOLLOW (no final-component symlink) and the
 *    security decision is taken on the open fd (open-then-fstat, never stat-then-open) — AC-11.
 *  - bounded streaming: read in fixed-size chunks with byte/line/time caps; the whole file is
 *    NEVER loaded and a single newline-less line is bounded — AC-06.
 *  - NEVER throws: any failure (missing, denied, escaped, unsupported platform) → null/[].
 *
 * The reader hands each complete line to a caller-supplied `onLine` and retains NOTHING: no
 * line content, no path, no buffer beyond the bounded in-flight accumulator (non-storage, G3).
 */
import {
  closeSync,
  constants as FS,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import {
  USAGE_MAX_BYTES,
  USAGE_MAX_LINES,
  USAGE_MAX_LINE_BYTES,
  USAGE_TIME_BUDGET_MS,
} from '../types';

export interface ConfinedReaderOptions {
  /** Code-fixed allowlist root (provider-owned; never user-supplied). */
  root: string;
  /** Current uid provider. Default process.getuid; returns -1 where unavailable (→ refuse). */
  getUid?: () => number;
  /** Injectable monotonic clock (ms) for the time budget (tests). Default Date.now. */
  now?: () => number;
  maxBytes?: number;
  maxLines?: number;
  maxLineBytes?: number;
  timeBudgetMs?: number;
}

/** Metadata-only stats from a bounded read — safe for a debug log (no content, no path). */
export interface ConfinedReadStats {
  bytesRead: number;
  lineCount: number;
  truncated: boolean; // hit a byte/line/time cap before EOF
  mtimeMs: number; // from fstat of the OPEN fd (TOCTOU-safe)
}

export interface ConfinedReader {
  /** The configured (un-resolved) root; providers build candidate paths under it. */
  readonly root: string;
  /** realpath(root) or null if the root does not resolve. */
  readonly rootReal: string | null;
  /** Metadata from the most recent readLines (for a metadata-only debug log). */
  readonly lastStats: ConfinedReadStats | null;
  /**
   * List immediate filenames under `absDir` (no recursion). Returns null on any failure or if
   * `absDir` resolves outside the root. readdir does not follow file-entry symlinks.
   */
  listDir(absDir: string): string[] | null;
  /**
   * Stream a confined file line-by-line into `onLine` (the caller extracts ONLY numeric usage
   * fields + the timestamp and retains nothing). Returns stats or null on refusal/error.
   * NEVER throws. `onLine` exceptions are swallowed per line so one bad line can't abort.
   */
  readLines(absPath: string, onLine: (line: string) => void): ConfinedReadStats | null;
}

const READ_CHUNK = 64 * 1024;

function isUnderRoot(rootReal: string, candidateReal: string): boolean {
  return candidateReal === rootReal || candidateReal.startsWith(rootReal + sep);
}

/** O_NOFOLLOW is POSIX; guard for platforms/builds that don't define it. */
const O_NOFOLLOW: number = typeof FS.O_NOFOLLOW === 'number' ? FS.O_NOFOLLOW : 0;

export function makeConfinedReader(opts: ConfinedReaderOptions): ConfinedReader {
  const root = opts.root;
  const getUid = opts.getUid ?? defaultGetUid;
  const now = opts.now ?? (() => Date.now());
  const maxBytes = opts.maxBytes ?? USAGE_MAX_BYTES;
  const maxLines = opts.maxLines ?? USAGE_MAX_LINES;
  const maxLineBytes = opts.maxLineBytes ?? USAGE_MAX_LINE_BYTES;
  const timeBudgetMs = opts.timeBudgetMs ?? USAGE_TIME_BUDGET_MS;

  let rootReal: string | null;
  try {
    rootReal = realpathSync(root);
  } catch {
    rootReal = null; // root absent/unreadable → reader is inert (everything → null)
  }

  let lastStats: ConfinedReadStats | null = null;

  function listDir(absDir: string): string[] | null {
    if (rootReal === null) return null;
    try {
      const real = realpathSync(absDir);
      if (!isUnderRoot(rootReal, real)) return null; // dir escapes root (symlink/..) → refuse
      return readdirSync(real); // names only; entries' symlinks are NOT followed here
    } catch {
      return null;
    }
  }

  function readLines(absPath: string, onLine: (line: string) => void): ConfinedReadStats | null {
    lastStats = null;
    if (rootReal === null) return null;

    // 1) Confinement: realpath the candidate and assert it stays under the root. A symlink that
    //    escapes is caught here, BEFORE any open — its target is never read (AC-04).
    let real: string;
    try {
      real = realpathSync(absPath);
    } catch {
      return null; // absent / broken symlink / permission → null (AC-07)
    }
    if (!isUnderRoot(rootReal, real)) return null;

    // 2) Open read-only with O_NOFOLLOW on the canonical path (guards a final-component swap to a
    //    symlink between realpath and open — TOCTOU). Never opens for write (read-only, AC-11).
    let fd: number;
    try {
      fd = openSync(real, FS.O_RDONLY | O_NOFOLLOW);
    } catch {
      return null; // ELOOP (symlink final component) / race / denied → null
    }

    try {
      // 3) Ownership + type decided on the OPEN fd (open-then-fstat, not stat-then-open, AC-05/11).
      const st = fstatSync(fd);
      if (!st.isFile()) return null; // reject dir/fifo/device/socket
      const uid = getUid();
      if (uid < 0) return null; // platform without uids (e.g. Windows) → degrade (AC-07)
      if (st.uid !== uid) return null; // other user's file → refuse, do not read (AC-05)

      // 4) Bounded streaming read: fixed-size chunks, byte/line/time caps, whole-file never loaded.
      const buffer = Buffer.allocUnsafe(READ_CHUNK);
      const decoder = new StringDecoder('utf8');
      const start = now();
      let bytesRead = 0;
      let lineCount = 0;
      let truncated = false;
      let pending = ''; // current (incomplete) line; bounded by maxLineBytes
      let dropping = false; // skipping the tail of an over-long line until the next newline

      const emit = (line: string): void => {
        lineCount += 1;
        try {
          onLine(line);
        } catch {
          /* one bad line never aborts the read (per-orc/ per-line isolation) */
        }
      };

      for (;;) {
        if (bytesRead >= maxBytes) {
          truncated = true;
          break;
        }
        if (lineCount >= maxLines) {
          truncated = true;
          break;
        }
        if (now() - start >= timeBudgetMs) {
          truncated = true;
          break;
        }
        const want = Math.min(buffer.length, maxBytes - bytesRead);
        let n: number;
        try {
          n = readSync(fd, buffer, 0, want, null);
        } catch {
          break; // EINTR/IO error → stop, best-effort with what we have
        }
        if (n <= 0) break; // EOF
        bytesRead += n;

        const chunk = decoder.write(buffer.subarray(0, n));
        let from = 0;
        for (;;) {
          const nl = chunk.indexOf('\n', from);
          if (nl === -1) break;
          const segment = chunk.slice(from, nl);
          from = nl + 1;
          if (dropping) {
            dropping = false; // this segment closes a dropped over-long line; skip it
            pending = '';
            continue;
          }
          const line = pending + segment;
          pending = '';
          if (line.length > 0) emit(line);
          if (lineCount >= maxLines) {
            truncated = true;
            break;
          }
        }
        if (!dropping && lineCount < maxLines) {
          pending += chunk.slice(from);
          // Bound the in-flight accumulator: a line with no newline cannot grow without limit.
          if (pending.length > maxLineBytes) {
            dropping = true;
            pending = '';
            truncated = true;
          }
        }
      }

      // Trailing line without a final newline (still a valid JSONL record).
      if (!dropping && pending.length > 0 && lineCount < maxLines) emit(pending);

      const stats: ConfinedReadStats = { bytesRead, lineCount, truncated, mtimeMs: st.mtimeMs };
      lastStats = stats;
      return stats;
    } catch {
      return null; // any unexpected error → null (never throws)
    } finally {
      try {
        closeSync(fd);
      } catch {
        /* fd already gone */
      }
    }
  }

  return {
    root,
    rootReal,
    get lastStats() {
      return lastStats;
    },
    listDir,
    readLines,
  };
}

function defaultGetUid(): number {
  return typeof process.getuid === 'function' ? process.getuid() : -1;
}
