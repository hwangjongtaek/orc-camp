/**
 * Integration tests (SPEC-102) — the real WebSocket endpoint on an ephemeral-port
 * server with fake scanner deps. Covers handshake auth (4401/4403), welcome frame,
 * batch diff on a content change, and heartbeat.
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type ServerHandle } from '../../src/server/serve';
import { makeDeps, type Scenario } from '../helpers/fixture';
import type { ServerSettings } from '../../src/server/types';

const WORK = { sessionId: '$1', sessionName: 'work', windows: 1 };
const CLAUDE = { sessionName: 'work', windowIndex: 1, paneIndex: 0, paneId: '%10', command: 'claude', cwd: '/Users/me/proj', pid: 1001, active: true };

function scenario(over: Partial<Scenario> = {}): Scenario {
  return { sessions: [WORK], panes: [CLAUDE], captures: { '%10': 'Editing src/server.ts' }, ps: { '1001': 'node /opt/claude/cli.js' }, ...over };
}

const handles: ServerHandle[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets) try { s.terminate(); } catch { /* */ }
  sockets.length = 0;
  while (handles.length) await handles.pop()!.close();
});

async function start(s: Scenario, settings?: Partial<ServerSettings>, heartbeatMs?: number): Promise<{ h: ServerHandle; wsUrl: string }> {
  const { deps } = makeDeps(s);
  const h = await startServer({
    deps, port: 0, runtimeEpoch: 'ws-epoch',
    settings: { scanIntervalS: 5, preview: { exposureEnabled: false, lineCount: 12 }, ...settings } as ServerSettings,
    ...(heartbeatMs !== undefined ? { heartbeatMs } : {}),
  });
  await h.ready;
  handles.push(h);
  return { h, wsUrl: `ws://127.0.0.1:${h.port}/api/events` };
}

function track(ws: WebSocket): WebSocket {
  sockets.push(ws);
  return ws;
}
function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.on('close', (code) => resolve(code)));
}
function waitFrame(ws: WebSocket, predicate: (f: any) => boolean, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('frame timeout')), timeoutMs);
    ws.on('message', (data) => {
      const f = JSON.parse(String(data));
      if (predicate(f)) { clearTimeout(timer); resolve(f); }
    });
  });
}

describe('SPEC-102 handshake auth (AC-10)', () => {
  it('rejects a tokenless handshake with close 4401', async () => {
    const { wsUrl } = await start(scenario());
    const ws = track(new WebSocket(wsUrl)); // no token
    expect(await waitClose(ws)).toBe(4401);
  });

  it('rejects a foreign Origin with close 4403', async () => {
    const { wsUrl, h } = await start(scenario());
    const ws = track(new WebSocket(`${wsUrl}?token=${h.token}`, { headers: { Origin: 'http://evil.example.com' } }));
    expect(await waitClose(ws)).toBe(4403);
  });

  it('accepts a valid token (query) and sends a welcome frame first', async () => {
    const { wsUrl, h } = await start(scenario());
    const ws = track(new WebSocket(`${wsUrl}?token=${h.token}`));
    const welcome = await waitFrame(ws, (f) => f.type === 'welcome');
    expect(welcome.seq).toBe(0);
    expect(welcome.payload.protocolVersion).toBe(1);
    expect(welcome.payload.runtimeEpoch).toBe('ws-epoch');
    expect(welcome.payload.version).toBeGreaterThanOrEqual(1);
    expect(typeof welcome.payload.heartbeatIntervalMs).toBe('number');
  });

  it('accepts a valid token via Sec-WebSocket-Protocol subprotocol', async () => {
    const { wsUrl, h } = await start(scenario());
    const ws = track(new WebSocket(wsUrl, ['orc-camp.v1', `token.${h.token}`]));
    const welcome = await waitFrame(ws, (f) => f.type === 'welcome');
    expect(welcome.payload.protocolVersion).toBe(1);
    expect(ws.protocol).toBe('orc-camp.v1'); // token part not echoed
  });
});

describe('SPEC-102 realtime delta (AC-02/03/11)', () => {
  it('streams a batch frame with a version bump on a content change', async () => {
    const s = scenario();
    const { wsUrl, h } = await start(s);
    const ws = track(new WebSocket(`${wsUrl}?token=${h.token}`));
    const welcome = await waitFrame(ws, (f) => f.type === 'welcome');
    const baseVersion = welcome.payload.version;

    // cause a content change and run a scan cycle
    s.captures!['%10'] = 'Now editing src/router.ts — different work entirely';
    await h.runtime.runScan();

    const batch = await waitFrame(ws, (f) => f.type === 'batch');
    expect(batch.version).toBe(baseVersion + 1);
    expect(batch.payload.version).toBe(baseVersion + 1);
    expect(Array.isArray(batch.payload.changes)).toBe(true);
    const types = batch.payload.changes.map((c: any) => c.type);
    expect(types).toContain('orc_status_changed');
    const change = batch.payload.changes.find((c: any) => c.type === 'orc_status_changed');
    expect(change.payload.orcId).toBe('pane:%10');
  });

  it('sends periodic heartbeats carrying version + stale', async () => {
    const { wsUrl, h } = await start(scenario(), undefined, 40);
    const ws = track(new WebSocket(`${wsUrl}?token=${h.token}`));
    const hb = await waitFrame(ws, (f) => f.type === 'server_heartbeat', 2000);
    expect(typeof hb.payload.version).toBe('number');
    expect(typeof hb.payload.stale).toBe('boolean');
  });
});
