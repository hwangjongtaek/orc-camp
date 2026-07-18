/**
 * SPEC-700 §2.6 / AC-11 — `orc-camp purge`: remove local user data (configDir + stateDir).
 *
 * npm uninstall deliberately leaves config/log behind (§2.6); purge is the explicit
 * opt-in that removes them. It is DESTRUCTIVE, so it dry-runs by default and only deletes
 * with `--yes`. A safety guard refuses to remove a home/root-level path (only the
 * orc-camp config/state dirs, or an explicit ORC_CAMP_*_DIR override, are eligible).
 *
 * The residue is never secret: startup tokens are memory-only (SPEC-100 §2.6) and terminal
 * output is never persisted (SPEC-006 §2.5) — purge removes preference config + redacted
 * debug logs (+ any P1 SQLite db) only.
 */
import { rmSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { resolveConfigDir, resolveStateDir } from './settings';

export interface PurgeOptions {
  io?: { stdout: (s: string) => void; stderr: (s: string) => void };
  env?: NodeJS.ProcessEnv;
}

interface PurgeArgs {
  yes: boolean;
  json: boolean;
  help: boolean;
  errors: string[];
}

function parseArgs(argv: string[]): PurgeArgs {
  const a: PurgeArgs = { yes: false, json: false, help: false, errors: [] };
  for (const tok of argv) {
    if (tok === '--yes' || tok === '-y') a.yes = true;
    else if (tok === '--json') a.json = true;
    else if (tok === '--help' || tok === '-h') a.help = true;
    else a.errors.push(`unknown flag: ${tok}`);
  }
  return a;
}

/** Refuse to delete a filesystem root or a home directory (guards against a mis-set env). */
function isUnsafeTarget(dir: string): boolean {
  const p = resolve(dir);
  return p === resolve(homedir()) || p === dirname(p);
}

export function purgeCommand(argv: string[], opts: PurgeOptions = {}): number {
  const io = opts.io ?? { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) };
  const env = opts.env ?? process.env;
  const args = parseArgs(argv);

  if (args.help) {
    io.stdout(
      'orc-camp purge [--yes] [--json]\n' +
        '  Removes local user data (config dir + state/log dir). Dry-run unless --yes.\n' +
        '  Run before `npm uninstall -g orc-camp` for a complete removal.\n',
    );
    return 0;
  }
  if (args.errors.length) {
    for (const e of args.errors) io.stderr(`error: ${e}\n`);
    return 2;
  }

  const configDir = resolveConfigDir(env);
  const stateDir = resolveStateDir(env);
  const targets = [...new Set([configDir, stateDir])].map((dir) => ({
    dir,
    exists: existsSync(dir),
    unsafe: isUnsafeTarget(dir),
  }));

  const removed: string[] = [];
  const refused: string[] = [];
  const skipped: string[] = [];

  for (const t of targets) {
    if (t.unsafe) {
      refused.push(t.dir);
      continue;
    }
    if (!t.exists) {
      skipped.push(t.dir);
      continue;
    }
    if (args.yes) {
      try {
        rmSync(t.dir, { recursive: true, force: true });
        removed.push(t.dir);
      } catch (e) {
        io.stderr(`could not remove ${t.dir}: ${e instanceof Error ? e.message : String(e)}\n`);
        return 1;
      }
    } else {
      removed.push(t.dir); // "would remove" in dry-run
    }
  }

  if (args.json) {
    io.stdout(JSON.stringify({ dryRun: !args.yes, removed, refused, skipped }) + '\n');
    return 0;
  }

  if (refused.length) {
    for (const d of refused) io.stderr(`refused (unsafe path): ${d}\n`);
  }
  if (args.yes) {
    if (removed.length === 0 && refused.length === 0) io.stdout('nothing to purge (no user data found)\n');
    else for (const d of removed) io.stdout(`removed ${d}\n`);
  } else {
    if (removed.length === 0) {
      io.stdout('nothing to purge (no user data found)\n');
    } else {
      io.stdout('would remove (pass --yes to apply):\n');
      for (const d of removed) io.stdout(`  ${d}\n`);
    }
  }
  return 0;
}
