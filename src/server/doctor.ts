/**
 * SPEC-100 §2.3/§3.5 — `orc-camp doctor`: 5 environment health checks (exit fail≥1).
 * SPEC-600 §2.9 — log.path detail + DoctorDiagnostics block (info only; no exit effect).
 */
import { accessSync, constants as FS, existsSync, statSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmuxExec as defaultTmuxExec } from '../tmux/exec';
import { isPortAvailable, PREFERRED_PORT } from './net';
import { isNoServerStderr, parseVersion } from '../tmux/inventory';
import { resolveConfigDir, resolveStateDir, SettingsStore } from './settings';
import { resolveAssetPackDir, type AssetPackSource } from './asset-pack';
import { APP_VERSION } from './version';
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
/**
 * SPEC-700 §2.4 — install-health (advisory; non-exit-bearing per SPEC-100 §2.3).
 * These values describe the installed/bundled artifact. They are reported inside
 * the SPEC-600 DoctorDiagnostics block and DO NOT contribute to doctor's exit code
 * (the 5 `runChecks` checks own exit semantics, SPEC-100 §3.5).
 */
export interface InstallHealth {
  nodeFloor: string; // package.json#engines.node (SPEC-700 §2.2)
  nodeFloorSatisfied: boolean; // current Node >= floor
  binResolved: boolean; // `orc-camp` resolves on PATH
  dashboardAssetsPresent: boolean; // dist/dashboard static assets bundled
  assetPackBundled: boolean; // asset-pack PNGs bundled INTO core (always false — D-054 ships them separately)
  // D-054 — the optional `orc-camp-assets` pack the server serves at /asset-pack/*.
  assetPackAvailable: boolean; // a pack was resolved (env or installed package)
  assetPackSource: AssetPackSource | null; // 'env' | 'package' | null (placeholders)
  assetPackDir: string | null; // resolved pack directory, or null
}

export interface DoctorDiagnostics {
  environment: { appVersion: string; nodeVersion: string; os: string; arch: string; tmuxVersion: string | null };
  installHealth: InstallHealth;
  log: LogPathDetail;
  recentErrors: { windowEntries: number; counts: { error: number; warn: number }; lastErrorAt: string | null; topCodes: { code: string; count: number }[] };
  // SPEC-104 §2.9 / §6 Q3 (D-053) — control-mode bridge advisory (STATIC capability +
  // config only; non-exit-bearing). The bridge is opt-in DEFAULT OFF and live view works
  // fully on SPEC-103 polling either way. Runtime trigger source / fallback history are
  // out of scope here (owned by the control.bridge_fallback activity audit).
  bridge: {
    enabled: boolean; // settings liveViewBridge (SPEC-500 §2.2, default false)
    tmuxVersion: string | null; // `tmux -V` (same source as environment.tmuxVersion)
    controlModeSupported: boolean; // parse ok && ignore-size version (>=3.2); parse fail → false
    socketArgs: string[]; // bridge -L/-S specifier (shares tmuxExec; [] = default socket)
    detail?: string; // reason when controlModeSupported=false
  };
}

/** Node major floor mirrored from package.json#engines.node (SPEC-700 §2.2). */
const NODE_FLOOR = '>=20';

function nodeMajor(v: string): number {
  return Number.parseInt(v.replace(/^v/, '').split('.')[0] ?? '0', 10) || 0;
}

/** True if an executable named `orc-camp` resolves on PATH (install integrity). */
function binResolves(env: NodeJS.ProcessEnv): boolean {
  try {
    const search = env.PATH ?? process.env.PATH ?? '';
    for (const dir of search.split(delimiter)) {
      if (!dir) continue;
      try {
        accessSync(join(dir, 'orc-camp'), FS.X_OK);
        return true;
      } catch {
        /* keep scanning */
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Existence check relative to this module's directory (the bundled `dist/` at runtime). */
function existsRelToModule(rel: string): boolean {
  try {
    return existsSync(fileURLToPath(new URL(rel, import.meta.url)));
  } catch {
    return false;
  }
}

function buildInstallHealth(env: NodeJS.ProcessEnv): InstallHealth {
  const floorMajor = Number.parseInt(NODE_FLOOR.match(/\d+/)?.[0] ?? '0', 10) || 0;
  const pack = resolveAssetPackDir(env);
  return {
    nodeFloor: NODE_FLOOR,
    nodeFloorSatisfied: nodeMajor(process.versions.node) >= floorMajor,
    binResolved: binResolves(env),
    dashboardAssetsPresent: existsRelToModule('./dashboard/index.html') || existsRelToModule('./dashboard'),
    assetPackBundled: existsRelToModule('./asset-packs/orc-camp-default/manifest.json') || existsRelToModule('./asset-packs'),
    assetPackAvailable: pack !== null,
    assetPackSource: pack?.source ?? null,
    assetPackDir: pack?.dir ?? null,
  };
}

/**
 * SPEC-104 §2.9 / D-053 — static control-mode capability from `tmux -V`. The
 * `ignore-size` client flag (size-neutral bridge attach, §2.2 P1-C) landed in tmux
 * 3.2, so control-mode bridge support requires a parseable version >= 3.2. Parse
 * failure fails safe to unsupported with a detail (never throws; no exit effect).
 */
function controlModeSupport(tmuxVersion: string | null): { supported: boolean; detail?: string } {
  if (tmuxVersion === null) return { supported: false, detail: 'tmux -V unavailable or unparseable' };
  const m = /(\d+)\.(\d+)/.exec(tmuxVersion);
  if (!m) return { supported: false, detail: `unrecognized tmux version '${tmuxVersion}'` };
  const major = Number.parseInt(m[1]!, 10);
  const minor = Number.parseInt(m[2]!, 10);
  if (major > 3 || (major === 3 && minor >= 2)) return { supported: true };
  return { supported: false, detail: `tmux ${tmuxVersion} < 3.2 (ignore-size unsupported)` };
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
    environment: { appVersion: APP_VERSION, nodeVersion: process.version, os: `${platform()} ${release()}`, arch: arch(), tmuxVersion },
    installHealth: buildInstallHealth(env),
    log: { path: dl.path(), writable: checkWritableDir(sdir).ok, sizeBytes: dl.sizeBytes(), level: dl.getLevel(), rotation: dl.rotation() },
    recentErrors: { windowEntries: entries.length, counts, lastErrorAt, topCodes },
    bridge: buildBridgeDiagnostics(env, tmuxVersion),
  };
}

/** SPEC-104 §2.9 / D-053 — static bridge diagnostics (config + capability; no exit effect). */
function buildBridgeDiagnostics(env: NodeJS.ProcessEnv, tmuxVersion: string | null): DoctorDiagnostics['bridge'] {
  // Config is read-only via SettingsStore (repairs/defaults on load; never throws).
  const enabled = SettingsStore.fromDir(resolveConfigDir(env)).current().liveViewBridge;
  const support = controlModeSupport(tmuxVersion);
  return {
    enabled,
    tmuxVersion,
    controlModeSupported: support.supported,
    socketArgs: [], // default socket (bridge shares tmuxExec's -L/-S; doctor has no runtime deps)
    ...(support.detail !== undefined ? { detail: support.detail } : {}),
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

  // SPEC-700 §2.4/AC-09 — advisory node-floor warning (stderr only; never affects exit).
  if (!diagnostics.installHealth.nodeFloorSatisfied) {
    io.stderr(`warning: Node ${diagnostics.environment.nodeVersion} is below the supported floor ${diagnostics.installHealth.nodeFloor}\n`);
  }

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
