/**
 * SPEC-700 §2.6 / AC-11 — `orc-camp purge` removes local config + state, safely.
 *
 * Verifies: dry-run by default (no deletion), --yes deletes, JSON shape, the home/root
 * safety guard, and CLI arg handling (help / unknown flag exit code).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { purgeCommand } from '../../src/server/purge';

function captureIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) }, out, err };
}

let root: string;
let cfg: string;
let state: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oc-purge-'));
  cfg = join(root, 'config');
  state = join(root, 'state');
  mkdirSync(cfg, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(cfg, 'config.json'), '{}');
  writeFileSync(join(state, 'debug.log'), 'log line\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const env = () => ({ ORC_CAMP_CONFIG_DIR: cfg, ORC_CAMP_STATE_DIR: state }) as NodeJS.ProcessEnv;

describe('SPEC-700 AC-11 — orc-camp purge', () => {
  it('dry-runs by default: nothing is deleted, both dirs are listed', () => {
    const { io, out } = captureIo();
    const code = purgeCommand([], { io, env: env() });
    expect(code).toBe(0);
    expect(existsSync(cfg)).toBe(true);
    expect(existsSync(state)).toBe(true);
    const text = out.join('');
    expect(text).toContain('would remove');
    expect(text).toContain(cfg);
    expect(text).toContain(state);
  });

  it('--yes deletes both config and state dirs', () => {
    const { io } = captureIo();
    const code = purgeCommand(['--yes'], { io, env: env() });
    expect(code).toBe(0);
    expect(existsSync(cfg)).toBe(false);
    expect(existsSync(state)).toBe(false);
  });

  it('--json reports {dryRun, removed, refused, skipped}', () => {
    const dry = captureIo();
    purgeCommand(['--json'], { io: dry.io, env: env() });
    const j = JSON.parse(dry.out.join('')) as { dryRun: boolean; removed: string[]; refused: string[]; skipped: string[] };
    expect(j.dryRun).toBe(true);
    expect(j.removed).toEqual(expect.arrayContaining([cfg, state]));
    expect(j.refused).toEqual([]);
    expect(existsSync(cfg)).toBe(true); // dry-run: still there

    const apply = captureIo();
    purgeCommand(['--yes', '--json'], { io: apply.io, env: env() });
    const j2 = JSON.parse(apply.out.join('')) as { dryRun: boolean; removed: string[] };
    expect(j2.dryRun).toBe(false);
    expect(j2.removed).toEqual(expect.arrayContaining([cfg, state]));
    expect(existsSync(cfg)).toBe(false);
  });

  it('refuses to remove a home directory even with --yes (safety guard)', () => {
    const { io, out } = captureIo();
    const home = homedir();
    const code = purgeCommand(['--yes', '--json'], {
      io,
      env: { ORC_CAMP_CONFIG_DIR: home, ORC_CAMP_STATE_DIR: state } as NodeJS.ProcessEnv,
    });
    expect(code).toBe(0);
    const j = JSON.parse(out.join('')) as { removed: string[]; refused: string[] };
    expect(j.refused).toContain(home);
    expect(j.removed).not.toContain(home);
    expect(existsSync(home)).toBe(true); // home is never touched
    expect(existsSync(state)).toBe(false); // the safe target is still purged
  });

  it('skips dirs that do not exist (nothing to purge)', () => {
    rmSync(cfg, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
    const { io, out } = captureIo();
    const code = purgeCommand(['--yes'], { io, env: env() });
    expect(code).toBe(0);
    expect(out.join('')).toContain('nothing to purge');
  });

  it('--help prints usage (exit 0) and deletes nothing', () => {
    const { io, out } = captureIo();
    const code = purgeCommand(['--help'], { io, env: env() });
    expect(code).toBe(0);
    expect(out.join('')).toContain('orc-camp purge');
    expect(existsSync(cfg)).toBe(true);
  });

  it('unknown flag exits 2', () => {
    const { io, err } = captureIo();
    const code = purgeCommand(['--wat'], { io, env: env() });
    expect(code).toBe(2);
    expect(err.join('')).toContain('unknown flag');
    expect(existsSync(cfg)).toBe(true);
  });
});
