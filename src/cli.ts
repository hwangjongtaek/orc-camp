/**
 * SPEC-001 — `orc-camp scan` CLI surface.
 *
 * Owns: flag set, output modes (human table / --json), single-shot vs --watch
 * lifecycle, stdout/stderr stream hygiene, exit codes (0/1/2), and table render
 * invocation. It does NOT define data shape (SPEC-005) or detection rules.
 *
 * Stream hygiene (SPEC-001 §2.4): stdout carries ONLY rendered data (table or JSON);
 * all progress/diagnostic/usage/error text goes to stderr, so `scan --json | jq` is
 * always clean.
 *
 * read-only invariant: scan never binds a port or runs a state-changing command —
 * the only subprocesses are the read-only tmux allowlist (SPEC-006 §2.6) and `ps`.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  WATCH_INTERVAL_DEFAULT_S,
  WATCH_INTERVAL_MAX_S,
  WATCH_INTERVAL_MIN_S,
  type ScanResult,
} from './types';
import { ScanRunner, createDefaultDeps, type ScanRuntimeDeps } from './scan';
import { renderTable } from './render/table';
import { toJsonLine } from './render/json';

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  isTTY: boolean;
  env: Record<string, string | undefined>;
}

export interface RunContext {
  io?: CliIO;
  deps?: ScanRuntimeDeps;
  /** Injectable sleep for --watch (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Checked at the top of each --watch cycle; return false to stop (tests). */
  shouldContinue?: () => boolean;
}

interface ParsedArgs {
  json: boolean;
  watch: boolean;
  watchIntervalS: number;
  noColor: boolean;
  help: boolean;
  version: boolean;
  errors: string[];
}

function defaultIO(): CliIO {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    isTTY: Boolean(process.stdout.isTTY),
    env: process.env,
  };
}

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const USAGE = `orc-camp scan — discover tmux camps and AI-agent orcs (read-only)

Usage:
  orc-camp scan [--json] [--watch [interval]] [--no-color]
  orc-camp scan (--help | --version)

Flags:
  --json              machine-readable JSON to stdout (one document; NDJSON with --watch)
  --watch [interval]  re-scan periodically (read-only). interval in seconds, ${WATCH_INTERVAL_MIN_S}-${WATCH_INTERVAL_MAX_S} (default ${WATCH_INTERVAL_DEFAULT_S})
  --no-color          disable ANSI color (also honored via NO_COLOR)
  --help, -h          show this help and exit
  --version, -V       print version and exit

Exit codes:
  0  scan completed (incl. empty states / per-target errors / --watch interrupt)
  1  catastrophic failure (no result produced)
  2  usage error (unknown flag / bad --watch interval)`;

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    json: false,
    watch: false,
    watchIntervalS: WATCH_INTERVAL_DEFAULT_S,
    noColor: false,
    help: false,
    version: false,
    errors: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    let flag = token;
    let inlineVal: string | undefined;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flag = token.slice(0, eq);
        inlineVal = token.slice(eq + 1);
      }
    }

    switch (flag) {
      case '--json':
        parsed.json = true;
        break;
      case '--no-color':
        parsed.noColor = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--version':
      case '-V':
        parsed.version = true;
        break;
      case '--no-preview':
        // reserved (SPEC-001 §2.1, D-021): parse-only, no effect in scan-MVP.
        break;
      case '--preview-lines': {
        // reserved: parse-only; consume an attached value if present.
        if (inlineVal === undefined) {
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith('-')) i++;
        }
        break;
      }
      case '--watch': {
        parsed.watch = true;
        let raw = inlineVal;
        if (raw === undefined) {
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith('-')) {
            raw = next;
            i++;
          }
        }
        if (raw !== undefined) {
          const n = Number(raw);
          if (!Number.isFinite(n) || n < WATCH_INTERVAL_MIN_S || n > WATCH_INTERVAL_MAX_S) {
            parsed.errors.push(
              `invalid --watch interval: ${raw} (expected ${WATCH_INTERVAL_MIN_S}-${WATCH_INTERVAL_MAX_S} seconds)`,
            );
          } else {
            parsed.watchIntervalS = n;
          }
        }
        break;
      }
      default:
        parsed.errors.push(
          token.startsWith('-') ? `unknown flag: ${token}` : `unexpected argument: ${token}`,
        );
    }
  }
  return parsed;
}

function decideColor(args: ParsedArgs, io: CliIO): boolean {
  if (args.json) return false;
  if (args.noColor) return false;
  if (io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== '') return false;
  return io.isTTY;
}

function emit(result: ScanResult, args: ParsedArgs, io: CliIO, color: boolean): void {
  if (args.json) io.stdout(toJsonLine(result) + '\n');
  else io.stdout(renderTable(result, { color }) + '\n');
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(argv: string[], ctx: RunContext = {}): Promise<number> {
  const io = ctx.io ?? defaultIO();
  const args = parseArgs(argv);

  // --help / --version take priority and never trigger a scan (no tmux spawn, AC-16).
  if (args.help) {
    io.stdout(USAGE + '\n');
    return 0;
  }
  if (args.version) {
    io.stdout(getVersion() + '\n');
    return 0;
  }
  if (args.errors.length > 0) {
    for (const e of args.errors) io.stderr(`error: ${e}\n`);
    io.stderr(`\nRun \`orc-camp scan --help\` for usage.\n`);
    return 2; // usage error — no stdout data
  }

  const deps = ctx.deps ?? createDefaultDeps();
  const runner = new ScanRunner(deps);
  const color = decideColor(args, io);

  if (!args.watch) {
    try {
      const result = await runner.scanOnce();
      emit(result, args, io, color); // single write → no partial stdout on failure
      return 0;
    } catch (err) {
      io.stderr(`fatal: ${errMessage(err)}\n`);
      return 1; // catastrophic: stdout left empty
    }
  }

  return runWatch(runner, args, io, color, ctx);
}

async function runWatch(
  runner: ScanRunner,
  args: ParsedArgs,
  io: CliIO,
  color: boolean,
  ctx: RunContext,
): Promise<number> {
  const sleep = ctx.sleep ?? realSleep;
  const intervalMs = args.watchIntervalS * 1000;

  let stopped = false;
  const installSignals = !ctx.shouldContinue;
  const onSignal = (): void => {
    stopped = true;
  };
  if (installSignals) {
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  }

  try {
    let cycle = 0;
    while (true) {
      if (stopped) break;
      if (ctx.shouldContinue && !ctx.shouldContinue()) break;
      cycle += 1;

      let result: ScanResult;
      try {
        result = await runner.scanOnce();
      } catch (err) {
        io.stderr(`fatal: ${errMessage(err)}\n`);
        return 1;
      }

      if (args.json) {
        io.stdout(toJsonLine(result) + '\n'); // NDJSON: one object per cycle
      } else {
        if (io.isTTY) io.stdout('\x1b[2J\x1b[H'); // clear + home before repaint
        io.stderr(`— cycle ${cycle} · scanned ${result.scannedAt}${result.stale ? ' (stale)' : ''}\n`);
        io.stdout(renderTable(result, { color }) + '\n');
      }

      if (stopped) break;
      await sleep(intervalMs);
    }
  } finally {
    if (installSignals) {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  }
  return 0; // --watch interrupt is a normal completion (SPEC-001 §2.5)
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Self-invoke when run directly (`tsx src/cli.ts` or `node dist/cli.js`).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
