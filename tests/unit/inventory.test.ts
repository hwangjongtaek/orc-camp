/**
 * SPEC-002 unit tests — pure parsing / classification + process introspection.
 * Deterministic: no live tmux, injected clock, fake spawn.
 */
import { describe, it, expect } from 'vitest';
import { FMT_P, FMT_S, US } from '../../src/types';
import {
  PANE_ID_RE,
  classifyExec,
  classifyListSessions,
  classifyProbe,
  comparePaneFields,
  epochToIso,
  isNoServerStderr,
  parsePaneLine,
  parseSessionLine,
  parseVersion,
} from '../../src/tmux/inventory';
import { makeProcessSnapshot, parsePsSnapshot, buildSubtree } from '../../src/tmux/introspect';
import {
  mkSpawnResult,
  enoent,
  paneLine,
  sessionLine,
  makeFakeSpawn,
  now,
} from '../fixtures/inventory';

const FIXED_ISO = '2026-06-26T12:00:00.000Z';

describe('FMT_P parsing (SPEC-002-AC-02/03)', () => {
  it('splits a FMT_P line into the 9 logical fields with correct types', () => {
    const line = paneLine({
      sessionName: 'work',
      windowIndex: 2,
      paneIndex: 3,
      paneId: '%12',
      command: 'node',
      paneTitle: 'claude',
      cwd: '/home/u/app',
      activity: '1750000000',
      pid: 4242,
      dead: false,
      active: true,
    });
    const f = parsePaneLine(line, now);
    expect(f).not.toBeNull();
    if (!f) return;

    expect(f.sessionName).toBe('work');
    expect(f.windowIndex).toBe(2);
    expect(f.paneIndex).toBe(3);
    expect(f.paneId).toBe('%12');
    expect(f.command).toBe('node'); // raw passthrough
    expect(f.rawTitle).toBe('claude');
    expect(f.rawCwd).toBe('/home/u/app');
    expect(typeof f.lastActivityAt).toBe('string');
    expect(f.panePid).toBe(4242);
    expect(f.paneDead).toBe(false);
    expect(f.paneActive).toBe(true);

    expect(typeof f.windowIndex).toBe('number');
    expect(typeof f.paneIndex).toBe('number');
  });

  it('falls back to window_activity when pane_activity is empty (tmux 3.6b, D-022)', () => {
    const base = {
      sessionName: 'work', windowIndex: 1, paneIndex: 0, paneId: '%1',
      command: 'zsh', paneTitle: '', cwd: '/x', pid: 1, dead: false, active: true,
    } as const;
    // pane_activity empty, window_activity present → uses window_activity epoch.
    const f = parsePaneLine(paneLine({ ...base, activity: '', windowActivity: '1750000000' }), now);
    expect(f?.lastActivityAt).toBe(new Date(1750000000 * 1000).toISOString());
    // both empty → epochToIso falls back to the injected clock (never throws / never blank).
    const g = parsePaneLine(paneLine({ ...base, activity: '', windowActivity: '' }), now);
    expect(typeof g?.lastActivityAt).toBe('string');
    expect(g?.lastActivityAt).toBe(now().toISOString());
  });

  it('derives tmuxTarget as sessionName:windowIndex.paneIndex', () => {
    const f = parsePaneLine(
      paneLine({
        sessionName: 'my sess', // spaces are why we use US, not ':'
        windowIndex: 1,
        paneIndex: 4,
        paneId: '%7',
        command: 'zsh',
        paneTitle: '',
        cwd: '/x',
        activity: '1750000000',
        pid: 1,
        dead: false,
        active: true,
      }),
      now,
    );
    expect(f?.tmuxTarget).toBe('my sess:1.4');
  });

  it('paneId matches ^%[0-9]+$', () => {
    const f = parsePaneLine(
      paneLine({
        sessionName: 's', windowIndex: 0, paneIndex: 0, paneId: '%108',
        command: 'zsh', paneTitle: '', cwd: '/x', activity: '0', pid: 1, dead: false, active: true,
      }),
      now,
    );
    expect(f?.paneId).toMatch(PANE_ID_RE);
    expect(PANE_ID_RE.test('%0')).toBe(true);
    expect(PANE_ID_RE.test('12')).toBe(false);
    expect(PANE_ID_RE.test('%')).toBe(false);
  });

  it('skips a line whose field count != FMT_P token count (parse_error)', () => {
    expect(FMT_P.split(US).length).toBe(12);
    expect(parsePaneLine(['work', '0', '1'].join(US), now)).toBeNull();
    // 11 fields (one short)
    const short = Array.from({ length: 11 }, (_, i) => String(i)).join(US);
    expect(parsePaneLine(short, now)).toBeNull();
  });

  it('tolerates empty title / empty pid', () => {
    const f = parsePaneLine(
      paneLine({
        sessionName: 's', windowIndex: 0, paneIndex: 0, paneId: '%0',
        command: 'node', paneTitle: '', cwd: '/x', activity: '0', pid: '', dead: true, active: false,
      }),
      now,
    );
    expect(f?.rawTitle).toBe('');
    expect(f?.panePid).toBeNull();
    expect(f?.paneDead).toBe(true);
  });
});

describe('FMT_S parsing', () => {
  it('parses a session record with typed fields', () => {
    expect(FMT_S.split(US).length).toBe(5);
    const s = parseSessionLine(
      sessionLine({ sessionId: '$3', sessionName: 'work', windows: 4, attached: true, activity: '1750000000' }),
      now,
    );
    expect(s).toEqual({
      sessionId: '$3',
      sessionName: 'work',
      windows: 4,
      attached: true,
      activityAt: new Date(1750000000 * 1000).toISOString(),
    });
  });

  it('returns null on field-count mismatch', () => {
    expect(parseSessionLine(['$0', 'x'].join(US), now)).toBeNull();
  });
});

describe('epoch → ISO 8601 (SPEC-002-AC-03, Q2)', () => {
  it('converts epoch seconds to a valid UTC ISO string', () => {
    expect(epochToIso('1750000000', now)).toBe(
      new Date(1750000000 * 1000).toISOString(),
    );
  });
  it('falls back to injected clock on empty/invalid/out-of-range', () => {
    expect(epochToIso('', now)).toBe(FIXED_ISO);
    expect(epochToIso('not-a-number', now)).toBe(FIXED_ISO);
    expect(epochToIso('9e99', now)).toBe(FIXED_ISO); // out of Date range
  });
});

describe('comparePaneFields (deterministic ordering, rule 6)', () => {
  it('orders by sessionName → windowIndex → paneIndex', () => {
    const mk = (sessionName: string, windowIndex: number, paneIndex: number) =>
      parsePaneLine(
        paneLine({
          sessionName, windowIndex, paneIndex, paneId: '%0', command: 'zsh',
          paneTitle: '', cwd: '/x', activity: '0', pid: 1, dead: false, active: true,
        }),
        now,
      )!;
    const arr = [mk('b', 0, 0), mk('a', 1, 0), mk('a', 0, 2), mk('a', 0, 1)];
    arr.sort(comparePaneFields);
    expect(arr.map((p) => p.tmuxTarget)).toEqual([
      'a:0.1',
      'a:0.2',
      'a:1.0',
      'b:0.0',
    ]);
  });
});

describe('version parsing', () => {
  it('strips the tmux prefix', () => {
    expect(parseVersion('tmux 3.3a\n')).toBe('3.3a');
    expect(parseVersion('tmux next-3.4')).toBe('next-3.4');
  });
  it('returns null on empty', () => {
    expect(parseVersion('   ')).toBeNull();
  });
});

describe('no-server stderr matcher (SPEC-002-AC-09)', () => {
  it('matches known no-server / connection error variants', () => {
    expect(isNoServerStderr('no server running on /tmp/tmux-1000/default')).toBe(true);
    expect(isNoServerStderr('error connecting to /tmp/tmux-1000/default (No such file or directory)')).toBe(true);
    expect(isNoServerStderr('NO SERVER RUNNING')).toBe(true);
  });
  it('does not match unrelated errors', () => {
    expect(isNoServerStderr("can't find pane: %99")).toBe(false);
    expect(isNoServerStderr('')).toBe(false);
  });
});

describe('availability classifiers (SPEC-002-AC-08/09/10)', () => {
  it('classifies probe: not_installed / ok / probe_error', () => {
    expect(classifyProbe(mkSpawnResult({ spawnError: enoent() }))).toEqual({
      kind: 'not_installed',
    });
    expect(classifyProbe(mkSpawnResult({ stdout: 'tmux 3.3a' }))).toEqual({
      kind: 'ok',
      version: '3.3a',
    });
    expect(classifyProbe(mkSpawnResult({ timedOut: true }))).toEqual({
      kind: 'probe_error',
      errKind: 'timeout',
    });
    expect(classifyProbe(mkSpawnResult({ exitCode: 2 }))).toEqual({
      kind: 'probe_error',
      errKind: 'exit_nonzero',
    });
  });

  it('classifies list-sessions empty states', () => {
    expect(
      classifyListSessions(mkSpawnResult({ exitCode: 1, stderr: 'no server running' })),
    ).toEqual({ kind: 'server_not_running' });
    expect(classifyListSessions(mkSpawnResult({ exitCode: 0, stdout: '' }))).toEqual({
      kind: 'running_no_session',
    });
    expect(
      classifyListSessions(mkSpawnResult({ exitCode: 0, stdout: 'x\x1fy\x1f1\x1f1\x1f0\n' })),
    ).toEqual({ kind: 'normal' });
  });

  it('classifies list-sessions exec failures (non no-server)', () => {
    expect(classifyListSessions(mkSpawnResult({ timedOut: true }))).toEqual({
      kind: 'failure',
      errKind: 'timeout',
    });
    expect(
      classifyListSessions(mkSpawnResult({ exitCode: 1, stderr: 'unexpected' })),
    ).toEqual({ kind: 'failure', errKind: 'exit_nonzero' });
  });

  it('classifies generic exec success/failure (list-panes / capture)', () => {
    expect(classifyExec(mkSpawnResult({ exitCode: 0 })).ok).toBe(true);
    expect(classifyExec(mkSpawnResult({ exitCode: 1 }))).toEqual({
      ok: false,
      errKind: 'exit_nonzero',
    });
    expect(classifyExec(mkSpawnResult({ timedOut: true }))).toEqual({
      ok: false,
      errKind: 'timeout',
    });
    expect(classifyExec(mkSpawnResult({ spawnError: enoent() }))).toEqual({
      ok: false,
      errKind: 'spawn_error',
    });
  });
});

describe('process snapshot (SPEC-002 §2.9 — AC-15/16/17/18/21)', () => {
  it('parsePsSnapshot parses `<pid> <ppid> <argv>` rows, skips garbled lines, keeps raw argv', () => {
    const entries = parsePsSnapshot(
      '  1001  1 node /x/cli.js --foo\n 1002 1001 npm exec\nhdr garbage\n\n',
    );
    expect(entries).toEqual([
      { pid: 1001, ppid: 1, command: 'node /x/cli.js --foo' },
      { pid: 1002, ppid: 1001, command: 'npm exec' },
    ]);
  });

  it('buildSubtree walks descendants from pane_pid with depth (deterministic depth→pid order)', () => {
    const entries = [
      { pid: 1000, ppid: 1, command: '-zsh' },
      { pid: 2000, ppid: 1000, command: 'claude' },
      { pid: 2001, ppid: 2000, command: 'node x' },
      { pid: 9999, ppid: 1, command: 'unrelated' },
    ];
    expect(buildSubtree(entries, 1000).map((n) => [n.pid, n.depth])).toEqual([
      [1000, 0],
      [2000, 1],
      [2001, 2],
    ]);
  });

  it('buildSubtree returns [] for an absent / invalid pane_pid (vs null snapshot)', () => {
    const entries = [{ pid: 1000, ppid: 1, command: '-zsh' }];
    expect(buildSubtree(entries, 4242)).toEqual([]);
    expect(buildSubtree(entries, null)).toEqual([]);
    expect(buildSubtree(entries, 0)).toEqual([]);
  });

  it('makeProcessSnapshot issues ONE fixed read-only `ps` argv with a per-call timeout', async () => {
    const { spawn, calls } = makeFakeSpawn(() => ({ stdout: '1001 1 node /x/cli.js\n' }));
    const entries = await makeProcessSnapshot(spawn, 1234, 'darwin')();
    expect(entries).toEqual([{ pid: 1001, ppid: 1, command: 'node /x/cli.js' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ file: 'ps', args: ['-axo', 'pid=,ppid=,command='], timeoutMs: 1234 });
  });

  it('selects the Linux argv projection on linux', async () => {
    const { spawn, calls } = makeFakeSpawn(() => ({ stdout: '1 0 /sbin/init\n' }));
    await makeProcessSnapshot(spawn, 1000, 'linux')();
    expect(calls[0]?.args).toEqual(['-eo', 'pid=,ppid=,args=']);
  });

  it('returns RAW argv (collector applies redact, not the snapshot)', async () => {
    const { spawn } = makeFakeSpawn(() => ({
      stdout: '10 1 node /x/cli.js --token=ghp_PLACEHOLDER0123\n',
    }));
    const entries = await makeProcessSnapshot(spawn)();
    expect(entries?.[0]?.command).toBe('node /x/cli.js --token=ghp_PLACEHOLDER0123');
  });

  it('fail-closed → null on timeout / spawnError / non-zero exit / empty output', async () => {
    const t = makeFakeSpawn(() => ({ timedOut: true }));
    expect(await makeProcessSnapshot(t.spawn)()).toBeNull();

    const e = makeFakeSpawn(() => ({ spawnError: enoent('ps missing') }));
    expect(await makeProcessSnapshot(e.spawn)()).toBeNull();

    const nz = makeFakeSpawn(() => ({ exitCode: 1, stdout: '' }));
    expect(await makeProcessSnapshot(nz.spawn)()).toBeNull();

    const empty = makeFakeSpawn(() => ({ exitCode: 0, stdout: '   \n' }));
    expect(await makeProcessSnapshot(empty.spawn)()).toBeNull();
  });

  it('never throws even if the injected spawn rejects', async () => {
    const spawn = (async () => {
      throw new Error('boom');
    }) as unknown as Parameters<typeof makeProcessSnapshot>[0];
    await expect(makeProcessSnapshot(spawn)()).resolves.toBeNull();
  });
});
