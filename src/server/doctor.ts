/**
 * SPEC-100 §2.3/§3.5 — `orc-camp doctor`: 5 environment health checks.
 * fail ≥1 → exit 1; warn never fails the exit (exit 0).
 */
import { accessSync, constants as FS, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { tmuxExec as defaultTmuxExec } from '../tmux/exec';
import { isPortAvailable, PREFERRED_PORT } from './net';
import { isNoServerStderr, parseVersion } from '../tmux/inventory';
import type { TmuxExecFn } from '../types';

type CheckStatus = 'pass' | 'warn' | 'fail';
interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'orc-camp');
}
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'orc-camp');
}

/** Writable if the dir (or its nearest existing ancestor) has write permission. */
function checkWritableDir(dir: string): { ok: boolean; detail: string } {
  let cur = dir;
  for (let i = 0; i < 12; i++) {
    try {
      const st = statSync(cur);
      if (st.isDirectory()) {
        try {
          accessSync(cur, FS.W_OK);
          return { ok: true, detail: dir };
        } catch {
          return { ok: false, detail: `${dir} (no write permission)` };
        }
      }
    } catch {
      /* not existing — walk up */
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return { ok: false, detail: `${dir} (unresolvable)` };
}

export interface DoctorOptions {
  io?: { stdout: (s: string) => void; stderr: (s: string) => void };
  tmuxExec?: TmuxExecFn;
  env?: NodeJS.ProcessEnv;
  host?: string;
}

export async function runChecks(opts: DoctorOptions = {}): Promise<Check[]> {
  const tmuxExec = opts.tmuxExec ?? defaultTmuxExec;
  const env = opts.env ?? process.env;
  const host = opts.host ?? '127.0.0.1';
  const checks: Check[] = [];

  const probe = await tmuxExec(null, ['-V']);
  const installed = probe.spawnError === null && probe.exitCode === 0;
  checks.push({
    id: 'tmux.installed',
    label: 'tmux installed',
    status: installed ? 'pass' : 'fail',
    detail: installed ? (parseVersion(probe.stdout) ?? 'installed') : 'tmux binary not found',
  });

  if (installed) {
    const ls = await tmuxExec('list-sessions', ['-F', '#{session_id}']);
    const reachable = ls.exitCode === 0;
    const noServer = !reachable && isNoServerStderr(ls.stderr);
    checks.push({
      id: 'tmux.serverReachable',
      label: 'tmux server reachable',
      status: reachable ? 'pass' : 'warn',
      detail: reachable ? 'reachable' : noServer ? 'no server running (camps will be empty)' : 'unreachable',
    });
  } else {
    checks.push({ id: 'tmux.serverReachable', label: 'tmux server reachable', status: 'warn', detail: 'skipped (tmux not installed)' });
  }

  const portOk = await isPortAvailable(host, PREFERRED_PORT);
  checks.push({
    id: 'port.available',
    label: `port ${PREFERRED_PORT} available`,
    status: portOk ? 'pass' : 'warn',
    detail: portOk ? 'available' : 'in use (will fall back to an ephemeral port)',
  });

  const cfg = checkWritableDir(configDir(env));
  checks.push({ id: 'config.dirAccess', label: 'config dir access', status: cfg.ok ? 'pass' : 'fail', detail: cfg.detail });

  const log = checkWritableDir(stateDir(env));
  checks.push({ id: 'log.path', label: 'debug log path', status: log.ok ? 'pass' : 'fail', detail: log.ok ? join(stateDir(env), 'debug.log') : log.detail });

  return checks;
}

interface DoctorArgs {
  json: boolean;
  report: string | null;
  help: boolean;
  errors: string[];
}
function parseDoctorArgs(argv: string[]): DoctorArgs {
  const a: DoctorArgs = { json: false, report: null, help: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === '--json') a.json = true;
    else if (tok === '--no-color') void 0;
    else if (tok === '--help' || tok === '-h') a.help = true;
    else if (tok === '--report') {
      const next = argv[i + 1];
      a.report = next !== undefined && !next.startsWith('-') ? (i++, next) : '';
    } else a.errors.push(`unknown flag: ${tok}`);
  }
  return a;
}

export async function doctorCommand(argv: string[], opts: DoctorOptions = {}): Promise<number> {
  const io = opts.io ?? { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) };
  const args = parseDoctorArgs(argv);
  if (args.help) {
    io.stdout('orc-camp doctor [--json] [--report [path]]\n');
    return 0;
  }
  if (args.errors.length) {
    for (const e of args.errors) io.stderr(`error: ${e}\n`);
    return 2;
  }

  const checks = await runChecks(opts);
  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };
  const ok = summary.fail === 0;

  if (args.json) {
    io.stdout(JSON.stringify({ checks, summary, ok }) + '\n');
  } else {
    for (const c of checks) {
      const dots = '.'.repeat(Math.max(2, 26 - c.label.length));
      io.stdout(`${c.label} ${dots} ${c.status} (${c.detail})\n`);
    }
  }

  if (args.report !== null) {
    const path = args.report || join(stateDir(opts.env ?? process.env), 'orc-camp-report.json');
    try {
      writeFileSync(path, JSON.stringify({ checks, summary, ok, generatedAt: new Date().toISOString() }, null, 2));
      io.stderr(`report written to ${path}\n`);
    } catch (e) {
      io.stderr(`could not write report: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  return ok ? 0 : 1;
}
