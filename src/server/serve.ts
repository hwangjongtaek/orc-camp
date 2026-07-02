/**
 * SPEC-100 §2.2/§2.4/§2.8 — `orc-camp` (default) / `orc-camp serve` lifecycle.
 *
 * `startServer` is the programmatic core (testable): generate token → create runtime
 * → create HTTP server → bind (with fallback) → start the scan loop. `serveCommand`
 * wraps it with flag parsing, stdout URL (stream hygiene), browser open, signal
 * handling, and exit codes.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PREVIEW_LINES, type ProcessSpawn } from '../types';
import { createDefaultDeps, type ScanRuntimeDeps } from '../scan';
import { SnapshotRuntime } from './runtime';
import { createHttpServer } from './http';
import { bindWithFallback, PREFERRED_PORT, isLoopback } from './net';
import { generateToken } from './token';
import { ControlService, makeControlExec } from './control';
import { PassthroughService } from './passthrough';
import { safeSpawn } from '../tmux/exec';
import { SettingsStore, resolveConfigDir, resolveStateDir } from './settings';
import { DebugLog, resolveLogLevel } from './debug-log';
import type { SecurityConfig } from './security';
import type { ServerSettings } from './types';

const DEV_ORIGINS = ['http://localhost:5173']; // FE dev server (PoC hypothesis)

export function defaultSettings(): ServerSettings {
  return { scanIntervalS: 3, preview: { exposureEnabled: false, lineCount: PREVIEW_LINES } };
}

export interface StartOptions {
  host?: string;
  port?: number; // preferred port; default PREFERRED_PORT
  explicitPort?: boolean; // user passed --port → no ephemeral fallback
  allowExternal?: boolean;
  deps?: ScanRuntimeDeps;
  controlSpawn?: ProcessSpawn; // send-keys write path (tests inject a fake; default safeSpawn)
  settings?: ServerSettings; // in-memory store (tests; no disk)
  configDir?: string; // disk-backed config (takes precedence over `settings`)
  stateDir?: string; // debug log location (default resolveStateDir)
  now?: () => Date;
  runtimeEpoch?: string;
  devOrigins?: string[];
  heartbeatMs?: number;
}

export interface ServerHandle {
  url: string; // token-bearing dashboard URL
  host: string;
  port: number;
  token: string;
  fellBack: boolean;
  runtime: SnapshotRuntime;
  settings: SettingsStore;
  debugLog: DebugLog;
  ready: Promise<void>; // resolves after the first published snapshot
  close: () => Promise<void>;
}

export async function startServer(opts: StartOptions = {}): Promise<ServerHandle> {
  const host = opts.host ?? '127.0.0.1';
  const preferred = opts.port ?? PREFERRED_PORT;
  const token = generateToken();
  const runtimeEpoch = opts.runtimeEpoch ?? randomUUID();
  const now = opts.now ?? ((): Date => new Date());
  const store = opts.configDir
    ? SettingsStore.fromDir(opts.configDir)
    : opts.settings
      ? SettingsStore.inMemory(opts.settings)
      : SettingsStore.fromDir(resolveConfigDir());
  const deps = opts.deps ?? createDefaultDeps();
  const debugLog = new DebugLog(opts.stateDir ?? resolveStateDir(), { level: resolveLogLevel(), now });

  const runtime = new SnapshotRuntime({ deps, settings: store, runtimeEpoch, now, debugLog });
  const passthrough = new PassthroughService(runtime, now); // SPEC-401 arm-session manager
  const control = new ControlService(runtime, makeControlExec(opts.controlSpawn ?? safeSpawn), now, passthrough);
  const security: SecurityConfig = {
    host,
    port: preferred,
    allowExternal: opts.allowExternal ?? false,
    devOrigins: opts.devOrigins ?? DEV_ORIGINS,
  };
  const server = createHttpServer({ runtime, security, token, now, settings: store, control, passthrough, ...(opts.heartbeatMs !== undefined ? { heartbeatMs: opts.heartbeatMs } : {}) });

  const { port, fellBack } = await bindWithFallback(server, host, preferred, opts.explicitPort ?? false);
  security.port = port; // fix CORS/Host to the actual port (single source, §3.4)

  const ready = runtime.start(); // first scan + loop (do not block URL output)

  const url = `http://${host}:${port}/?token=${token}`;
  const close = async (): Promise<void> => {
    passthrough.disposeAll(); // flush any live arm-session audits (SPEC-401)
    runtime.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { url, host, port, token, fellBack, runtime, settings: store, debugLog, ready, close };
}

// --- CLI wrapper -----------------------------------------------------------

export interface ServeIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

interface ServeArgs {
  host: string;
  port: number | null;
  allowExternal: boolean;
  noOpen: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
  errors: string[];
}

export function parseServeArgs(argv: string[]): ServeArgs {
  const a: ServeArgs = { host: '127.0.0.1', port: null, allowExternal: false, noOpen: false, json: false, help: false, version: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    let flag = tok;
    let inline: string | undefined;
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq !== -1) {
        flag = tok.slice(0, eq);
        inline = tok.slice(eq + 1);
      }
    }
    const takeVal = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        i++;
        return next;
      }
      return undefined;
    };
    switch (flag) {
      case '--host': {
        const v = takeVal();
        if (v === undefined) a.errors.push('--host requires an address');
        else a.host = v;
        break;
      }
      case '--port': {
        const v = takeVal();
        const n = Number(v);
        if (v === undefined || !Number.isInteger(n) || n < 1 || n > 65535) a.errors.push(`invalid --port: ${v ?? '(none)'}`);
        else a.port = n;
        break;
      }
      case '--allow-external': a.allowExternal = true; break;
      case '--no-open': a.noOpen = true; break;
      case '--json': a.json = true; break;
      case '--no-color': break;
      case '--help': case '-h': a.help = true; break;
      case '--version': case '-V': a.version = true; break;
      default: a.errors.push(tok.startsWith('-') ? `unknown flag: ${tok}` : `unexpected argument: ${tok}`);
    }
  }
  return a;
}

function openBrowser(url: string, spawnFn: typeof spawn): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;
    const [cmd, args] = platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    try {
      const child = spawnFn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => resolve(false));
      child.unref();
      // assume success if no immediate error
      setTimeout(() => resolve(true), 50).unref?.();
    } catch {
      resolve(false);
    }
  });
}

export interface ServeCommandOptions {
  open: boolean; // default command opens the browser; `serve` does not
  io?: ServeIO;
  startOpts?: StartOptions;
}

/** Long-running. Resolves to an exit code on shutdown (SIGINT/SIGTERM → 0). */
export async function serveCommand(argv: string[], opts: ServeCommandOptions): Promise<number> {
  const io = opts.io ?? { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) };
  const args = parseServeArgs(argv);

  if (args.help) {
    io.stdout(SERVE_USAGE + '\n');
    return 0;
  }
  if (args.version) {
    io.stdout(version() + '\n');
    return 0;
  }
  if (args.errors.length > 0) {
    for (const e of args.errors) io.stderr(`error: ${e}\n`);
    return 2;
  }
  if (!isLoopback(args.host) && !args.allowExternal) {
    io.stderr('error: binding to a non-loopback host requires --allow-external\n');
    return 2;
  }

  let handle: ServerHandle;
  try {
    handle = await startServer({
      host: args.host,
      ...(args.port !== null ? { port: args.port, explicitPort: true } : {}),
      allowExternal: args.allowExternal,
      ...opts.startOpts,
    });
  } catch (err) {
    io.stderr(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // stdout: URL only (stream hygiene). All notices → stderr.
  io.stdout((args.json ? JSON.stringify({ url: handle.url, host: handle.host, port: handle.port, pid: process.pid }) : handle.url) + '\n');
  if (handle.fellBack) io.stderr(`preferred port busy; using ${handle.port}\n`);
  if (!isLoopback(args.host)) io.stderr(`WARNING: bound to ${args.host} — anyone on your network with the token URL can control your tmux\n`);

  if (opts.open && !args.noOpen && handle.settings.current().browserAutoOpen) {
    const ok = await openBrowser(handle.url, spawn);
    io.stderr(ok ? 'opened dashboard in your default browser\n' : `could not open a browser; open this URL manually: ${handle.url}\n`);
  }
  io.stderr('press Ctrl-C to stop\n');

  return await new Promise<number>((resolve) => {
    const shutdown = (): void => {
      void handle.close().then(() => resolve(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

function version(): string {
  return '0.1.0';
}

const SERVE_USAGE = `orc-camp serve — start the local Orc Camp server (read-only tmux + REST API)

Usage:
  orc-camp            [--port <n>] [--host <addr> [--allow-external]] [--no-open] [--json]
  orc-camp serve      [--port <n>] [--host <addr> [--allow-external]] [--json]

Prints a token-bearing dashboard URL on stdout. Binds 127.0.0.1 by default.`;

/** Re-export for a possible injected spawn in tests. */
export type { ProcessSpawn };
