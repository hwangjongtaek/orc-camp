/**
 * SPEC-600 §2.5–2.8 — local debug log (JSON Lines + rotation + redaction-before-write).
 *
 * Invariant ①: NO capture text / preview / summary / token in the log. Every free-text
 * `message` passes redact() right before write (defense-in-depth); only an allowlist of
 * metadata fields is serialized. Write failures are non-fatal; rotation bounds disk use.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from '../redaction/redact';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogComponent = 'scanner' | 'api' | 'control' | 'tmux' | 'ws' | 'server';

export interface DebugLogEntry {
  ts: string;
  level: LogLevel;
  component: LogComponent;
  code: string;
  phase?: string;
  command?: string;
  paneId?: string;
  target?: string;
  exitCode?: number;
  durationMs?: number;
  matchCount?: number;
  requestId?: string;
  errorId?: string;
  message?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_KEEP_FILES = 3;
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

const ALLOWED_KEYS: (keyof DebugLogEntry)[] = [
  'ts', 'level', 'component', 'code', 'phase', 'command', 'paneId', 'target',
  'exitCode', 'durationMs', 'matchCount', 'requestId', 'errorId', 'message',
];

export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const v = env.ORC_CAMP_LOG_LEVEL;
  return v === 'error' || v === 'warn' || v === 'info' || v === 'debug' ? v : DEFAULT_LOG_LEVEL;
}

export interface DebugLogOptions {
  stateDir: string;
  level?: LogLevel;
  maxBytes?: number;
  keep?: number;
  now?: () => Date;
}

export class DebugLog {
  private level: LogLevel;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly now: () => Date;

  constructor(private readonly stateDir: string, opts: Partial<DebugLogOptions> = {}) {
    this.level = opts.level ?? DEFAULT_LOG_LEVEL;
    this.maxBytes = opts.maxBytes ?? LOG_MAX_BYTES;
    this.keep = opts.keep ?? LOG_KEEP_FILES;
    this.now = opts.now ?? ((): Date => new Date());
  }

  path(): string {
    return join(this.stateDir, 'debug.log');
  }
  getLevel(): LogLevel {
    return this.level;
  }
  setLevel(l: LogLevel): void {
    this.level = l;
  }
  sizeBytes(): number {
    try {
      return statSync(this.path()).size;
    } catch {
      return 0;
    }
  }
  rotation(): { maxBytes: number; keep: number } {
    return { maxBytes: this.maxBytes, keep: this.keep };
  }

  write(entry: Omit<DebugLogEntry, 'ts'> & { ts?: string }): void {
    if (LEVEL_ORDER[entry.level] > LEVEL_ORDER[this.level]) return; // below threshold
    const ts = entry.ts ?? this.now().toISOString();
    const redactedMessage = typeof entry.message === 'string' ? redact(entry.message).text : undefined; // redaction-before-write
    const safe: Record<string, unknown> = {};
    for (const k of ALLOWED_KEYS) {
      if (k === 'ts') safe.ts = ts;
      else if (k === 'message') {
        if (redactedMessage !== undefined) safe.message = redactedMessage;
      } else if (entry[k] !== undefined) safe[k] = entry[k];
    }
    const line = JSON.stringify(safe) + '\n';
    try {
      mkdirSync(this.stateDir, { recursive: true });
      this.rotateIfNeeded(line.length);
      appendFileSync(this.path(), line);
    } catch {
      /* log write failure is non-fatal (§2.8) */
    }
  }

  private rotateIfNeeded(incoming: number): void {
    if (this.sizeBytes() + incoming <= this.maxBytes) return;
    try {
      rmSync(`${this.path()}.${this.keep}`, { force: true });
      for (let i = this.keep - 1; i >= 1; i--) {
        try {
          renameSync(`${this.path()}.${i}`, `${this.path()}.${i + 1}`);
        } catch {
          /* missing file — skip */
        }
      }
      renameSync(this.path(), `${this.path()}.1`);
    } catch {
      /* rotation failure is non-fatal */
    }
  }

  /** Read the last `maxEntries` parsed entries of the active file (doctor recentErrors). */
  readTail(maxEntries: number): DebugLogEntry[] {
    let text = '';
    try {
      text = readFileSync(this.path(), 'utf8');
    } catch {
      return [];
    }
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    const out: DebugLogEntry[] = [];
    for (const line of lines.slice(-maxEntries)) {
      try {
        out.push(JSON.parse(line) as DebugLogEntry);
      } catch {
        /* skip unparseable */
      }
    }
    return out;
  }
}
