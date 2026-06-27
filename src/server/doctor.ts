/**
 * SPEC-100 §2.3/§3.5 — `orc-camp doctor`: 5 environment health checks (exit fail≥1).
 * SPEC-600 §2.9 — log.path detail + DoctorDiagnostics block (info only; no exit effect).
 */
import { accessSync, constants as FS, statSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { tmuxExec as defaultTmuxExec } from '../tmux/exec';
import { isPortAvailable, PREFERRED_PORT } from './net';
import { isNoServerStderr, parseVersion } from '../tmux/inventory';
import { resolveConfigDir, resolveStateDir } from './settings';
import { DebugLog, resolveLogLevel, type DebugLogEntry } from './debug-log';
import type { TmuxExecFn } from '../types';

type CheckStatus = 'pass' | 'warn' | 'fail';
interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
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

  const cfg = checkWritableDir(resolveConfigDir(env));
  checks.push({ id: 'config.dirAccess', label: 'config dir access', status: cfg.ok ? 'pass' : 'fail', detail: cfg.detail });

  const sdir = resolveStateDir(env);
  const log = checkWritableDir(sdir);
  checks.push({ id: 'log.path', label: 'debug log path', status: log.ok ? 'pass' : 'fail', detail: log.ok ? join(sdir, 'debug.log') : log.detail });

  return checks;
}

export interface LogPathDetail {
  path: string;
  writable: boolean;
  sizeBytes: number;
  level: string;
  rotation: { maxBytes: number; keep: number };
}
export interface DoctorDiagnostics {
  environment: { appVersion: string; nodeVersion: string; os: string; arch: string; tmuxVersion: string | null };
  log: LogPathDetail;
  recentErrors: { windowEntries: number; counts: { error: number; warn: number }; lastErrorAt: string | null; topCodes: { code: string; count: number }[] };
}

/** SPEC-600 §2.9(B) — observability diagnostics (no terminal content; no exit effect). */
export async function buildDiagnostics(opts: DoctorOptions = {}): Promise<DoctorDiagnostics> {
  const env = opts.env ?? process.env;
  const tmuxExec = opts.tmuxExec ?? defaultTmuxExec;
  const sdir = resolveStateDir(env);
  const dl = new DebugLog(sdir, { level: resolveLogLevel(env) });
  const probe = await tmuxExec(null, ['-V']);
  const tmuxVersion = probe.spawnError === null && probe.exitCode === 0 ? parseVersion(probe.stdout) : null;

  const entries = dl.readTail(200);
  const counts = { error: 0, warn: 0 };
  const codeCounts = new Map<string, number>();
  let lastErrorAt: string | null = null;
  for (const e of entries) {
    if (e.level === 'error') { counts.error += 1; lastErrorAt = e.ts; }
    else if (e.level === 'warn') counts.warn += 1;
    if (e.code) codeCounts.set(e.code, (codeCounts.get(e.code) ?? 0) + 1);
  }
  const topCodes = [...codeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([code, count]) => ({ code, count }));

  return {
    environment: { appVersion: '0.1.0', nodeVersion: process.version, os: `${platform()} ${release()}`, arch: arch(), tmuxVersion },
    log: { path: dl.path(), writable: checkWritableDir(sdir).ok, sizeBytes: dl.sizeBytes(), level: dl.getLevel(), rotation: dl.rotation() },
    recentErrors: { windowEntries: entries.length, counts, lastErrorAt, topCodes },
  };
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
  const diagnostics = await buildDiagnostics(opts);

  if (args.json) {
    io.stdout(JSON.stringify({ checks, summary, ok, diagnostics }) + '\n');
  } else {
    for (const c of checks) {
      const dots = '.'.repeat(Math.max(2, 26 - c.label.length));
      io.stdout(`${c.label} ${dots} ${c.status} (${c.detail})\n`);
    }
    io.stdout(`\nenvironment: orc-camp ${diagnostics.environment.appVersion} · node ${diagnostics.environment.nodeVersion} · ${diagnostics.environment.os} ${diagnostics.environment.arch}\n`);
    io.stdout(`debug log: ${diagnostics.log.path} (level ${diagnostics.log.level}, ${diagnostics.log.sizeBytes}B)\n`);
  }

  if (args.report !== null) {
    const path = args.report || join(resolveStateDir(opts.env ?? process.env), 'orc-camp-report.json');
    try {
      writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), doctor: { checks, summary, ok }, diagnostics }, null, 2));
      io.stderr(`report written to ${path}\n`);
    } catch (e) {
      io.stderr(`could not write report: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  return ok ? 0 : 1;
}
