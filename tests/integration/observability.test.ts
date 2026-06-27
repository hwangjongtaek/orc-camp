/**
 * Integration tests (SPEC-600) — activity WS frame, server-written debug log, and
 * doctor diagnostics, over the real server with fake scanner deps + temp stateDir.
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type ServerHandle } from '../../src/server/serve';
import { doctorCommand } from '../../src/server/doctor';
import { makeDeps, type Scenario } from '../helpers/fixture';
import type { SpawnResult, TmuxExecFn } from '../../src/types';

const WORK = { sessionId: '$1', sessionName: 'work', windows: 1 };
const CLAUDE = { sessionName: 'work', windowIndex: 1, paneIndex: 0, paneId: '%10', command: 'claude', cwd: '/Users/me/proj', pid: 1001, active: true };
function scenario(over: Partial<Scenario> = {}): Scenario {
  return { sessions: [WORK], panes: [CLAUDE], captures: { '%10': 'work a' }, ps: { '1001': 'node claude' }, ...over };
}

const handles: ServerHandle[] = [];
const sockets: WebSocket[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const s of sockets) try { s.terminate(); } catch { /* */ }
  sockets.length = 0;
  while (handles.length) await handles.pop()!.close();
  for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  dirs.length = 0;
});
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'orc-camp-obs-'));
  dirs.push(d);
  return d;
}
async function start(s: Scenario, stateDir: string): Promise<{ h: ServerHandle; wsUrl: string }> {
  const { deps } = makeDeps(s);
  const h = await startServer({ deps, port: 0, runtimeEpoch: 'obs', settings: { scanIntervalS: 5, preview: { exposureEnabled: false, lineCount: 12 } }, stateDir, heartbeatMs: 60_000 });
  await h.ready;
  handles.push(h);
  return { h, wsUrl: `ws://127.0.0.1:${h.port}/api/events` };
}
function waitFrame(ws: WebSocket, predicate: (f: any) => boolean, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('frame timeout')), timeoutMs);
    ws.on('message', (d) => { const f = JSON.parse(String(d)); if (predicate(f)) { clearTimeout(t); resolve(f); } });
  });
}

describe('SPEC-600 activity WS frame (AC-04)', () => {
  it('emits an activity frame (orc.status_changed) on a status change', async () => {
    const s = scenario();
    const { h, wsUrl } = await start(s, tempDir());
    const ws = new WebSocket(`${wsUrl}?token=${h.token}`);
    sockets.push(ws);
    await waitFrame(ws, (f) => f.type === 'welcome');
    s.captures!['%10'] = 'now doing something entirely different and new';
    await h.runtime.runScan();
    const act = await waitFrame(ws, (f) => f.type === 'activity' && f.payload.type === 'orc.status_changed');
    expect(act.payload.target.orcId).toBe('pane:%10');
    expect(act.payload.code).toMatch(/^status\./);
    expect(act.payload.source).toBe('server');
    expect(typeof act.payload.seq).toBe('number');
  });
});

describe('SPEC-600 server debug log (AC-05)', () => {
  it('writes a JSON-Lines tmux error entry on a capture failure', async () => {
    const dir = tempDir();
    await start(scenario({ captureFail: ['%10'] }), dir);
    const path = join(dir, 'debug.log');
    expect(existsSync(path)).toBe(true);
    const entries = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const tmuxErr = entries.find((e) => e.component === 'tmux');
    expect(tmuxErr).toBeTruthy();
    expect(tmuxErr.code).toMatch(/^tmux\./);
    expect(tmuxErr.paneId).toBe('%10');
    expect(tmuxErr.ts).toBeTruthy();
  });
});

describe('SPEC-600 doctor diagnostics (AC-10/11)', () => {
  function fakeTmux(): TmuxExecFn {
    const ok = (stdout: string): SpawnResult => ({ stdout, stderr: '', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1 });
    return async (sub) => (sub === null ? ok('tmux 3.6b\n') : ok('$0\n'));
  }
  it('doctor --json includes log.path detail + diagnostics with recentErrors code aggregation', async () => {
    const dir = tempDir();
    // seed a debug log with two error entries of the same code
    writeFileSync(join(dir, 'debug.log'),
      JSON.stringify({ ts: '2026-06-27T10:00:00.000Z', level: 'error', component: 'tmux', code: 'tmux.exit_nonzero' }) + '\n' +
      JSON.stringify({ ts: '2026-06-27T10:00:01.000Z', level: 'error', component: 'tmux', code: 'tmux.exit_nonzero' }) + '\n' +
      JSON.stringify({ ts: '2026-06-27T10:00:02.000Z', level: 'warn', component: 'scanner', code: 'scanner.stale' }) + '\n');
    let out = '';
    const code = await doctorCommand(['--json'], { io: { stdout: (s) => (out += s), stderr: () => {} }, tmuxExec: fakeTmux(), env: { ...process.env, ORC_CAMP_STATE_DIR: dir } });
    expect(code).toBe(0);
    const r = JSON.parse(out.trim());
    expect(r.diagnostics.environment.nodeVersion).toBe(process.version);
    expect(r.diagnostics.log.path).toBe(join(dir, 'debug.log'));
    expect(r.diagnostics.log.level).toBeTruthy();
    expect(r.diagnostics.recentErrors.counts.error).toBe(2);
    expect(r.diagnostics.recentErrors.topCodes[0]).toEqual({ code: 'tmux.exit_nonzero', count: 2 });
    expect(r.diagnostics.recentErrors.lastErrorAt).toBe('2026-06-27T10:00:01.000Z');
    // no terminal content leaked
    expect(out).not.toContain('proj');
  });
});
