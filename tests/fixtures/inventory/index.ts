/**
 * SPEC-007 §2.3 inventory/process fixtures + deterministic fake injections.
 *
 * No real secrets: secret samples use placeholder token shapes only
 * (SPEC-000 conventions, SPEC-006 §2.2).
 */
import { US, FMT_S, FMT_P } from '../../../src/types';
import type {
  ProcessSnapshotEntry,
  ProcessSnapshotFn,
  ProcessSpawn,
  RedactFn,
  SanitizeFn,
  SpawnResult,
  TmuxExecFn,
} from '../../../src/types';

// ---------------------------------------------------------------------------
// SpawnResult builder
// ---------------------------------------------------------------------------

export function mkSpawnResult(r: Partial<SpawnResult> = {}): SpawnResult {
  const timedOut = r.timedOut ?? false;
  const spawnError = r.spawnError ?? null;
  const exitCode =
    r.exitCode !== undefined ? r.exitCode : timedOut || spawnError ? null : 0;
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode,
    timedOut,
    spawnError,
    durationMs: r.durationMs ?? 1,
  };
}

export function enoent(message = 'spawn tmux ENOENT'): NodeJS.ErrnoException {
  const e = new Error(message) as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

// ---------------------------------------------------------------------------
// -F line builders (field order MUST mirror FMT_S / FMT_P in src/types.ts)
// ---------------------------------------------------------------------------

function bool01(v: boolean | string): string {
  return typeof v === 'boolean' ? (v ? '1' : '0') : v;
}

export interface SessionSpec {
  sessionId: string;
  sessionName: string;
  windows: number | string;
  attached: boolean | string;
  activity: string; // epoch seconds
}

export function sessionLine(s: SessionSpec): string {
  return [
    s.sessionId,
    s.sessionName,
    String(s.windows),
    bool01(s.attached),
    s.activity,
  ].join(US);
}

export interface PaneSpec {
  sessionName: string;
  windowIndex: number | string;
  paneIndex: number | string;
  paneId: string;
  command: string;
  paneTitle: string;
  cwd: string;
  activity: string; // epoch seconds
  pid: number | string | '';
  dead: boolean | string;
  active: boolean | string;
}

export function paneLine(p: PaneSpec): string {
  return [
    p.sessionName,
    String(p.windowIndex),
    String(p.paneIndex),
    p.paneId,
    p.command,
    p.paneTitle,
    p.cwd,
    p.activity,
    p.pid === '' ? '' : String(p.pid),
    bool01(p.dead),
    bool01(p.active),
  ].join(US);
}

// sanity: builders emit exactly the frozen field counts.
if (sessionLine({
  sessionId: '$0', sessionName: 'x', windows: 1, attached: true, activity: '0',
}).split(US).length !== FMT_S.split(US).length) {
  throw new Error('sessionLine field count drift vs FMT_S');
}
if (paneLine({
  sessionName: 'x', windowIndex: 0, paneIndex: 0, paneId: '%0', command: 'zsh',
  paneTitle: '', cwd: '/', activity: '0', pid: 1, dead: false, active: true,
}).split(US).length !== FMT_P.split(US).length) {
  throw new Error('paneLine field count drift vs FMT_P');
}

// ---------------------------------------------------------------------------
// Fake tmuxExec backend with an argv log (read-only observation, SPEC-007 §2.2)
// ---------------------------------------------------------------------------

export interface ExecCall {
  subcommand: string | null;
  args: string[];
}

export interface InventoryFixture {
  version?: Partial<SpawnResult>;
  listSessions?: Partial<SpawnResult>;
  listPanes?: Partial<SpawnResult>;
  /** capture-pane responses keyed by paneId (`-t <paneId>`). */
  captures?: Record<string, Partial<SpawnResult>>;
  captureDefault?: Partial<SpawnResult>;
}

export function makeFakeTmux(fx: InventoryFixture): {
  tmuxExec: TmuxExecFn;
  argvLog: ExecCall[];
} {
  const argvLog: ExecCall[] = [];
  const tmuxExec: TmuxExecFn = async (subcommand, args) => {
    argvLog.push({ subcommand, args: [...args] });
    if (subcommand === null) {
      return mkSpawnResult(fx.version ?? { stdout: 'tmux 3.3a\n' });
    }
    if (subcommand === 'list-sessions') {
      return mkSpawnResult(fx.listSessions ?? { stdout: '' });
    }
    if (subcommand === 'list-panes') {
      return mkSpawnResult(fx.listPanes ?? { stdout: '' });
    }
    if (subcommand === 'capture-pane') {
      const ti = args.indexOf('-t');
      const paneId = ti >= 0 ? args[ti + 1] : undefined;
      const resp =
        (paneId !== undefined ? fx.captures?.[paneId] : undefined) ??
        fx.captureDefault ?? { stdout: 'line-1\nline-2\n' };
      return mkSpawnResult(resp);
    }
    // Should never be reached in a read-only scan; surface loudly if it is.
    return mkSpawnResult({ exitCode: 0 });
  };
  return { tmuxExec, argvLog };
}

// ---------------------------------------------------------------------------
// Fake process snapshot / redact / sanitize spies (SPEC-002 §2.9)
// ---------------------------------------------------------------------------

/**
 * Fake single-snapshot process collector. `entries` is the whole process table
 * (raw argv); `null` simulates an unavailable/failed snapshot (fail-closed →
 * every pane's processTree = null). `calls` counts invocations (asserts O(1) spawn).
 */
export function makeFakeProcessSnapshot(
  entries: ProcessSnapshotEntry[] | null = null,
): { processSnapshot: ProcessSnapshotFn; calls: { n: number } } {
  const calls = { n: 0 };
  const processSnapshot: ProcessSnapshotFn = async () => {
    calls.n += 1;
    return entries;
  };
  return { processSnapshot, calls };
}

/** Deterministic redaction: masks placeholder GitHub tokens and argv `--token=`. */
export function makeFakeRedact(): { redact: RedactFn; calls: string[] } {
  const calls: string[] = [];
  const redact: RedactFn = (text) => {
    calls.push(text);
    const masked = text
      .replace(/ghp_[A-Za-z0-9_]+/g, '[REDACTED:github-token]')
      .replace(/--token=\S+/g, '--token=[REDACTED:token]');
    const redacted = masked !== text;
    return { text: masked, redacted, matchCount: redacted ? 1 : 0 };
  };
  return { redact, calls };
}

export function makeFakeSanitize(): { sanitize: SanitizeFn; calls: string[] } {
  const calls: string[] = [];
  const sanitize: SanitizeFn = (raw) => {
    calls.push(raw);
    const masked = raw.replace(/ghp_[A-Za-z0-9_]+/g, '[REDACTED:github-token]');
    const redacted = masked !== raw;
    return {
      lines: masked.split('\n'),
      redacted,
      byteClamped: false,
      matchCount: redacted ? 1 : 0,
    };
  };
  return { sanitize, calls };
}

/** Records (file, args, opts) for makeIntrospect argv-hardening assertions. */
export function makeFakeSpawn(
  responder: (file: string, args: string[]) => Partial<SpawnResult>,
): { spawn: ProcessSpawn; calls: Array<{ file: string; args: string[]; timeoutMs: number }> } {
  const calls: Array<{ file: string; args: string[]; timeoutMs: number }> = [];
  const spawn: ProcessSpawn = async (file, args, opts) => {
    calls.push({ file, args: [...args], timeoutMs: opts.timeoutMs });
    return mkSpawnResult(responder(file, args));
  };
  return { spawn, calls };
}

// ---------------------------------------------------------------------------
// Deterministic clock
// ---------------------------------------------------------------------------

export const FIXED_NOW = new Date('2026-06-26T12:00:00.000Z');
export const now = (): Date => FIXED_NOW;

// ---------------------------------------------------------------------------
// Named fixtures (SPEC-007 §2.3 catalog)
// ---------------------------------------------------------------------------

const A = '1750000000'; // 2025-06-15T...Z epoch seconds

/** Placeholder secret (token shape only — never a real credential). */
export const GHP_TOKEN = 'ghp_PLACEHOLDER0123456789abcdef';

/** INV-NORMAL: server running, two sessions, three live panes (out of order). */
export const INV_NORMAL: InventoryFixture = {
  version: { stdout: 'tmux 3.3a\n' },
  listSessions: {
    stdout:
      [
        sessionLine({ sessionId: '$1', sessionName: 'play', windows: 1, attached: false, activity: A }),
        sessionLine({ sessionId: '$0', sessionName: 'work', windows: 1, attached: true, activity: A }),
      ].join('\n') + '\n',
  },
  listPanes: {
    // intentionally unsorted to exercise comparePaneFields
    stdout:
      [
        paneLine({ sessionName: 'work', windowIndex: 0, paneIndex: 1, paneId: '%1', command: 'node', paneTitle: 'claude', cwd: '/home/u/work/app', activity: A, pid: 1001, dead: false, active: false }),
        paneLine({ sessionName: 'play', windowIndex: 0, paneIndex: 0, paneId: '%2', command: 'vim', paneTitle: 'edit', cwd: '/home/u/play', activity: A, pid: 1002, dead: false, active: true }),
        paneLine({ sessionName: 'work', windowIndex: 0, paneIndex: 0, paneId: '%0', command: 'zsh', paneTitle: 'shell', cwd: '/home/u/work', activity: A, pid: 1000, dead: false, active: true }),
      ].join('\n') + '\n',
  },
  captures: {
    // a planted placeholder secret to exercise the sanitize chokepoint
    '%0': { stdout: `$ echo token ${GHP_TOKEN}\nready\n` },
  },
  captureDefault: { stdout: 'output line a\noutput line b\n' },
};

export const INV_NOT_INSTALLED: InventoryFixture = {
  version: { spawnError: enoent() },
};

export const INV_NO_SERVER: InventoryFixture = {
  version: { stdout: 'tmux 3.3a\n' },
  listSessions: {
    exitCode: 1,
    stderr: 'no server running on /tmp/tmux-1000/default',
  },
};

export const INV_NO_SESSION: InventoryFixture = {
  version: { stdout: 'tmux 3.3a\n' },
  listSessions: { exitCode: 0, stdout: '' },
};

/** INV-NO-AGENT: panes exist but are all non-agent shells (detection is downstream). */
export const INV_NO_AGENT: InventoryFixture = {
  version: { stdout: 'tmux 3.3a\n' },
  listSessions: {
    stdout:
      sessionLine({ sessionId: '$0', sessionName: 'work', windows: 1, attached: true, activity: A }) + '\n',
  },
  listPanes: {
    stdout:
      [
        paneLine({ sessionName: 'work', windowIndex: 0, paneIndex: 0, paneId: '%0', command: 'zsh', paneTitle: '', cwd: '/home/u', activity: A, pid: 2000, dead: false, active: true }),
        paneLine({ sessionName: 'work', windowIndex: 0, paneIndex: 1, paneId: '%1', command: 'vim', paneTitle: 'README', cwd: '/home/u/docs', activity: A, pid: 2001, dead: false, active: false }),
      ].join('\n') + '\n',
  },
};

/** INV-PARSE-ERR: one malformed (short) pane line interleaved with a good one. */
export const INV_PARSE_ERR: InventoryFixture = {
  version: { stdout: 'tmux 3.3a\n' },
  listSessions: {
    stdout:
      sessionLine({ sessionId: '$0', sessionName: 'work', windows: 1, attached: true, activity: A }) + '\n',
  },
  listPanes: {
    stdout:
      [
        paneLine({ sessionName: 'work', windowIndex: 0, paneIndex: 0, paneId: '%0', command: 'zsh', paneTitle: 'shell', cwd: '/home/u', activity: A, pid: 3000, dead: false, active: true }),
        // malformed: only 3 fields instead of 11
        ['work', '0', '1'].join(US),
      ].join('\n') + '\n',
  },
};

/** INV-DEAD-PANE: one dead pane (#{pane_dead}=1) — no capture-pane for it. */
export const INV_DEAD_PANE: InventoryFixture = {
  version: { stdout: 'tmux 3.3a\n' },
  listSessions: {
    stdout:
      sessionLine({ sessionId: '$0', sessionName: 'work', windows: 1, attached: true, activity: A }) + '\n',
  },
  listPanes: {
    stdout:
      [
        paneLine({ sessionName: 'work', windowIndex: 0, paneIndex: 0, paneId: '%0', command: 'zsh', paneTitle: 'shell', cwd: '/home/u', activity: A, pid: 4000, dead: false, active: true }),
        paneLine({ sessionName: 'work', windowIndex: 0, paneIndex: 1, paneId: '%9', command: 'node', paneTitle: 'gone', cwd: '/home/u/app', activity: A, pid: '', dead: true, active: false }),
      ].join('\n') + '\n',
  },
};

/** INV-FIRST-FAIL: sessions OK but list-panes fails; no last-good (runner owns fallback). */
export const INV_FIRST_FAIL: InventoryFixture = {
  version: { stdout: 'tmux 3.3a\n' },
  listSessions: {
    stdout:
      sessionLine({ sessionId: '$0', sessionName: 'work', windows: 1, attached: true, activity: A }) + '\n',
  },
  listPanes: { exitCode: 1, stderr: 'lost server' },
};

export const PANE_PIDS = {
  workShell: 1000,
  workNode: 1001,
  playVim: 1002,
} as const;
