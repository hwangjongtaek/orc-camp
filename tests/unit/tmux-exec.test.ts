/**
 * SPEC-006 §2.6 read-only enforcement + hardened spawn tests.
 *
 * Coverage:
 *   AC-12(a) — state-changing subcommands (send-keys / paste-buffer / kill-server)
 *              THROW and never spawn; allow-listed subcommands and the `-V` probe
 *              DO spawn with a fixed argv.
 *   AC-14    — the timeout path returns a SpawnResult (timedOut) without throwing.
 *   safeSpawn — passes `shell:false` and the fixed argv, decodes utf-8, and never
 *               throws on a spawn error event (returns spawnError instead).
 */
import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the child_process module so safeSpawn drives a controllable fake child.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';
import { safeSpawn, makeTmuxExec, tmuxExec } from '../../src/tmux/exec';
import type { ProcessSpawn, SpawnResult } from '../../src/types';

const mockSpawn = vi.mocked(spawn);

/** A minimal fake ChildProcess with controllable stdout/stderr/close/error. */
function makeFakeChild() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const child = new EventEmitter() as any;
  child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
  child.kill = vi.fn();
  return child;
}

/** A recording fake ProcessSpawn for the tmuxExec allowlist tests. */
function makeRecorder(result?: SpawnResult) {
  const calls: Array<{ file: string; args: string[]; timeoutMs: number }> = [];
  const fn: ProcessSpawn = async (file, args, opts) => {
    calls.push({ file, args, timeoutMs: opts.timeoutMs });
    return (
      result ?? {
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        spawnError: null,
        durationMs: 1,
      }
    );
  };
  return { fn, calls };
}

describe('tmuxExec — fail-closed read-only enforcement (AC-12)', () => {
  it.each(['send-keys', 'paste-buffer', 'kill-server'])(
    'throws and never spawns for state-changing subcommand: %s',
    (sub) => {
      const { fn, calls } = makeRecorder();
      const exec = makeTmuxExec(fn);
      expect(() => exec(sub, ['anything'])).toThrow();
      expect(calls).toHaveLength(0);
    },
  );

  it('rejects arbitrary non-allowlisted subcommands (fail-closed default)', () => {
    const { fn, calls } = makeRecorder();
    const exec = makeTmuxExec(fn);
    expect(() => exec('totally-made-up', [])).toThrow();
    expect(calls).toHaveLength(0);
  });

  it('spawns allow-listed subcommands and the -V probe with fixed argv', async () => {
    const { fn, calls } = makeRecorder();
    const exec = makeTmuxExec(fn, 1234);
    await exec('list-panes', ['-a', '-F', 'fmt']);
    await exec('capture-pane', ['-p', '-t', '%1']);
    await exec(null, ['-V']);
    expect(calls.map((c) => c.args[0])).toEqual([
      'list-panes',
      'capture-pane',
      '-V',
    ]);
    expect(calls[0]).toEqual({
      file: 'tmux',
      args: ['list-panes', '-a', '-F', 'fmt'],
      timeoutMs: 1234,
    });
    expect(calls[2]).toEqual({ file: 'tmux', args: ['-V'], timeoutMs: 1234 });
  });

  it('rejects a null subcommand whose args are not exactly ["-V"] (no spawn)', () => {
    const { fn, calls } = makeRecorder();
    const exec = makeTmuxExec(fn);
    expect(() => exec(null, ['list-sessions'])).toThrow();
    expect(() => exec(null, [])).toThrow();
    expect(() => exec(null, ['-V', 'extra'])).toThrow();
    expect(calls).toHaveLength(0);
  });

  it('AC-14: timeout path returns a SpawnResult without throwing', async () => {
    const timed: SpawnResult = {
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: true,
      spawnError: null,
      durationMs: 2000,
    };
    const { fn } = makeRecorder(timed);
    const exec = makeTmuxExec(fn);
    const res = await exec('capture-pane', ['-p', '-t', '%1']);
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBeNull();
  });

  it('default tmuxExec is a function wired from makeTmuxExec(safeSpawn)', () => {
    expect(typeof tmuxExec).toBe('function');
  });
});

describe('safeSpawn — hardened primitive', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('passes shell:false + fixed argv and decodes utf-8 stdout/stderr', async () => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);
    const p = safeSpawn('tmux', ['list-panes', '-a'], { timeoutMs: 1000 });
    child.stdout.emit('data', 'hello');
    child.stderr.emit('data', 'warn');
    child.emit('close', 0);
    const res = await p;
    expect(mockSpawn).toHaveBeenCalledWith('tmux', ['list-panes', '-a'], {
      shell: false,
    });
    expect(res).toMatchObject({
      stdout: 'hello',
      stderr: 'warn',
      exitCode: 0,
      timedOut: false,
      spawnError: null,
    });
    expect(typeof res.durationMs).toBe('number');
  });

  it('never throws on a spawn error event; reports spawnError + null exitCode', async () => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);
    const p = safeSpawn('tmux', ['-V'], { timeoutMs: 1000 });
    const enoent = Object.assign(new Error('spawn tmux ENOENT'), {
      code: 'ENOENT',
    });
    child.emit('error', enoent);
    const res = await p;
    expect(res.spawnError).toBe(enoent);
    expect(res.exitCode).toBeNull();
    expect(res.timedOut).toBe(false);
  });
});
