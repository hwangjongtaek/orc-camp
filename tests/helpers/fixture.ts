/**
 * Integration test helper: a fixture-backed `ProcessSpawn` that drives the REAL
 * `makeTmuxExec`/`makeIntrospect` wrappers (so the read-only allowlist + hardening
 * are exercised end-to-end), plus deterministic deps for the ScanRunner/CLI.
 *
 * All secrets in fixtures MUST be placeholders (SPEC-000 / SPEC-006 §2.2).
 */
import { FMT_P, FMT_S, US, type ProcessSpawn, type SpawnResult } from '../../src/types';
import { makeTmuxExec, safeSpawn } from '../../src/tmux/exec';
import { makeProcessSnapshot } from '../../src/tmux/introspect';
import { redact, sanitizeCapture } from '../../src/redaction/redact';
import { detectOrc, defaultDetectors } from '../../src/detection/detect';
import { inferStatus } from '../../src/status/infer';
import type { ScanRuntimeDeps } from '../../src/scan';

export interface SessionFields {
  sessionId: string; // "$1"
  sessionName: string;
  windows?: number;
  attached?: boolean;
  activityEpoch?: number;
}

export interface PaneFields {
  sessionName: string;
  windowIndex: number;
  paneIndex: number;
  paneId: string; // "%12"
  command: string; // #{pane_current_command}
  paneTitle?: string;
  cwd?: string;
  activityEpoch?: number;
  pid?: number | null;
  dead?: boolean;
  active?: boolean;
}

export interface Scenario {
  installed?: boolean; // false → `tmux -V` spawn ENOENT
  version?: string;
  serverState?: 'normal' | 'no-server' | 'no-session';
  sessions?: SessionFields[];
  panes?: PaneFields[];
  captures?: Record<string, string>; // paneId → raw capture text
  captureFail?: string[]; // paneIds whose capture-pane fails
  inventoryFail?: boolean; // list-panes exits non-zero on a running server
  ps?: Record<string, string>; // pid → cmdline argv (snapshot synthesized as `<pid> 1 <cmdline>`)
  /** Full process-table snapshot (SPEC-002 §2.9) for subtree tests. Overrides `ps`. */
  processTable?: Array<{ pid: number; ppid: number; command: string }>;
}

const DEFAULT_EPOCH = Math.floor(Date.parse('2026-06-27T10:00:00.000Z') / 1000);

function sessionLine(s: SessionFields): string {
  return [
    s.sessionId,
    s.sessionName,
    String(s.windows ?? 1),
    s.attached ? '1' : '0',
    String(s.activityEpoch ?? DEFAULT_EPOCH),
  ].join(US);
}

function paneLine(p: PaneFields): string {
  return [
    p.sessionName,
    String(p.windowIndex),
    String(p.paneIndex),
    p.paneId,
    p.command,
    p.paneTitle ?? '',
    p.cwd ?? '/Users/me/proj',
    String(p.activityEpoch ?? DEFAULT_EPOCH),
    String(p.pid ?? 1000),
    p.dead ? '1' : '0',
    p.active ? '1' : '0',
  ].join(US);
}

function ok(stdout: string): SpawnResult {
  return { stdout, stderr: '', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1 };
}
function fail(stderr: string, exitCode = 1): SpawnResult {
  return { stdout: '', stderr, exitCode, timedOut: false, spawnError: null, durationMs: 1 };
}
function enoent(): SpawnResult {
  const e = new Error('spawn tmux ENOENT') as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return { stdout: '', stderr: '', exitCode: null, timedOut: false, spawnError: e, durationMs: 0 };
}

export interface SpawnLogEntry {
  file: string;
  args: string[];
}

export function makeScenarioSpawn(scenario: Scenario): {
  spawn: ProcessSpawn;
  log: SpawnLogEntry[];
} {
  const log: SpawnLogEntry[] = [];
  const installed = scenario.installed ?? true;
  const serverState = scenario.serverState ?? 'normal';

  const spawn: ProcessSpawn = async (file, args) => {
    log.push({ file, args });

    if (file === 'tmux') {
      const sub = args[0];
      if (sub === '-V') return installed ? ok(`tmux ${scenario.version ?? '3.6b'}\n`) : enoent();
      if (sub === 'list-sessions') {
        if (serverState === 'no-server') return fail('no server running on /tmp/tmux-501/default');
        if (serverState === 'no-session') return ok('');
        return ok((scenario.sessions ?? []).map(sessionLine).join('\n') + '\n');
      }
      if (sub === 'list-panes') {
        if (scenario.inventoryFail) return fail('list-panes: connection error');
        return ok((scenario.panes ?? []).map(paneLine).join('\n') + '\n');
      }
      if (sub === 'capture-pane') {
        const tIdx = args.indexOf('-t');
        const id = tIdx !== -1 ? args[tIdx + 1] : undefined;
        if (id && (scenario.captureFail ?? []).includes(id)) return fail('capture-pane: no such pane');
        return ok(id && scenario.captures ? (scenario.captures[id] ?? '') : '');
      }
      return fail(`unexpected tmux subcommand: ${String(sub)}`);
    }

    if (file === 'ps') {
      // SPEC-002 §2.9 single read-only snapshot: `ps -axo pid=,ppid=,command=` (or -eo … args=).
      // Build a `<pid> <ppid> <argv>` table from processTable (preferred) or the `ps` pid→cmdline
      // map (ppid synthesized = 1). No process info → empty stdout → snapshot null (fail-closed).
      const rows: string[] = [];
      if (scenario.processTable) {
        for (const n of scenario.processTable) rows.push(`${n.pid} ${n.ppid} ${n.command}`);
      } else if (scenario.ps) {
        for (const [pid, cmd] of Object.entries(scenario.ps)) rows.push(`${pid} 1 ${cmd}`);
      }
      return rows.length > 0 ? ok(rows.join('\n') + '\n') : fail('ps: no process info');
    }

    return fail(`unexpected spawn: ${file}`);
  };

  return { spawn, log };
}

export const FIXED_CLOCK = '2026-06-27T10:00:00.000Z';

export function makeDeps(
  scenario: Scenario,
  clockIso: string = FIXED_CLOCK,
): { deps: ScanRuntimeDeps; log: SpawnLogEntry[] } {
  const { spawn, log } = makeScenarioSpawn(scenario);
  const deps: ScanRuntimeDeps = {
    tmuxExec: makeTmuxExec(spawn),
    processSnapshot: makeProcessSnapshot(spawn),
    sanitize: sanitizeCapture,
    redact,
    detectOrc,
    inferStatus,
    detectors: defaultDetectors,
    now: () => new Date(clockIso),
  };
  return { deps, log };
}

/** Re-export for tests that want to confirm the production spawn primitive exists. */
export { safeSpawn };
export { FMT_P, FMT_S };

export interface CapturedIO {
  stdout: () => string;
  stderr: () => string;
  io: {
    stdout: (s: string) => void;
    stderr: (s: string) => void;
    isTTY: boolean;
    env: Record<string, string | undefined>;
  };
}

export function makeIO(opts: { isTTY?: boolean; env?: Record<string, string | undefined> } = {}): CapturedIO {
  let out = '';
  let err = '';
  return {
    stdout: () => out,
    stderr: () => err,
    io: {
      stdout: (s: string) => {
        out += s;
      },
      stderr: (s: string) => {
        err += s;
      },
      isTTY: opts.isTTY ?? false,
      env: opts.env ?? {},
    },
  };
}
