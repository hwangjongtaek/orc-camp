/**
 * Integration tests (Epic 2) — the real HTTP server on an ephemeral port, driven by
 * fixture-backed fake scanner deps (no live tmux). Covers SPEC-100 security boundary
 * (auth/CORS/Host) + SPEC-101 REST (health/snapshot/version/camps/preview/refresh).
 */
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { startServer, type ServerHandle } from '../../src/server/serve';
import { makeDeps, type Scenario } from '../helpers/fixture';
import type { ServerSettings } from '../../src/server/types';

const WORK = { sessionId: '$1', sessionName: 'work', windows: 1 };
const CLAUDE = { sessionName: 'work', windowIndex: 1, paneIndex: 0, paneId: '%10', command: 'claude', cwd: '/Users/me/proj', pid: 1001, active: true };
const SHELL = { sessionName: 'work', windowIndex: 1, paneIndex: 1, paneId: '%11', command: 'zsh', pid: 1002 };

function normalScenario(over: Partial<Scenario> = {}): Scenario {
  return {
    sessions: [WORK],
    panes: [CLAUDE, SHELL],
    captures: { '%10': 'Editing src/server.ts', '%11': '$ ' },
    ps: { '1001': 'node /opt/claude/cli.js', '1002': '-zsh' },
    ...over,
  };
}

const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length) await handles.pop()!.close();
});

async function start(scenario: Scenario, settings?: Partial<ServerSettings>): Promise<{ h: ServerHandle; base: string }> {
  const { deps } = makeDeps(scenario);
  const h = await startServer({
    deps,
    port: 0,
    runtimeEpoch: 'test-epoch',
    settings: { scanIntervalS: 5, preview: { exposureEnabled: false, lineCount: 12 }, ...settings } as ServerSettings,
  });
  await h.ready;
  handles.push(h);
  return { h, base: `http://127.0.0.1:${h.port}` };
}

function authed(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

function rawReq(port: number, method: string, path: string, headers: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('SPEC-101 health + snapshot (AC-01/14)', () => {
  it('GET /api/health needs no token and reports liveness without workspace data', async () => {
    const { base } = await start(normalScenario());
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('ok');
    expect(body.snapshotVersion).toBeGreaterThanOrEqual(1);
    expect(body.runtimeEpoch).toBe('test-epoch');
    expect(body.tmux.installed).toBe(true);
    expect(JSON.stringify(body)).not.toContain('proj'); // no cwd/workspace leakage
  });

  it('GET /api/snapshot requires a token (D-024 read gating, AC-20)', async () => {
    const { base } = await start(normalScenario());
    expect((await fetch(`${base}/api/snapshot`)).status).toBe(401);
    const bad = await fetch(`${base}/api/snapshot`, { headers: authed('wrong-token') });
    expect(bad.status).toBe(401);
  });

  it('GET /api/snapshot with token returns the SPEC-005 ScanResult under a thin envelope', async () => {
    const { base, h } = await start(normalScenario());
    const res = await fetch(`${base}/api/snapshot`, { headers: authed(h.token) });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${h.runtime.snapshotVersion}"`);
    const body = (await res.json()) as any;
    expect(body.snapshotVersion).toBeGreaterThanOrEqual(1);
    expect(body.runtimeEpoch).toBe('test-epoch');
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.camps[0].id).toBe('session:$1');
    expect(body.data.camps[0].orcs[0].agentType).toBe('claude-code');
    expect(Array.isArray(body.recentActivity)).toBe(true);
  });

  it('If-None-Match with the current ETag yields 304', async () => {
    const { base, h } = await start(normalScenario());
    const etag = `"${h.runtime.snapshotVersion}"`;
    const res = await fetch(`${base}/api/snapshot`, { headers: authed(h.token, { 'If-None-Match': etag }) });
    expect(res.status).toBe(304);
  });
});

describe('SPEC-101 version monotonicity (AC-03)', () => {
  it('refresh with no content change keeps version; a content change bumps it +1', async () => {
    const scenario = normalScenario();
    const { base, h } = await start(scenario);
    const v0 = h.runtime.snapshotVersion;
    const r1 = await fetch(`${base}/api/refresh`, { method: 'POST', headers: authed(h.token) });
    expect(r1.status).toBe(200);
    expect(h.runtime.snapshotVersion).toBe(v0); // identical content → no bump

    scenario.captures!['%10'] = 'Now editing src/router.ts — different work';
    // refresh is rate-limited (R_min 1s); wait a beat then refresh
    await new Promise((r) => setTimeout(r, 1100));
    const r2 = await fetch(`${base}/api/refresh`, { method: 'POST', headers: authed(h.token) });
    expect(r2.status).toBe(200);
    expect(h.runtime.snapshotVersion).toBe(v0 + 1); // metadata (summary) changed → bump
  });
});

describe('SPEC-101 camps + preview (AC-12, §2.11 gates)', () => {
  it('GET /api/camps/:id matches by sessionId; 404/400 for missing/malformed', async () => {
    const { base, h } = await start(normalScenario());
    const ok = await fetch(`${base}/api/camps/${encodeURIComponent('session:$1')}`, { headers: authed(h.token) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).data.id).toBe('session:$1');
    expect((await fetch(`${base}/api/camps/${encodeURIComponent('session:$9')}`, { headers: authed(h.token) })).status).toBe(404);
    expect((await fetch(`${base}/api/camps/not-a-camp`, { headers: authed(h.token) })).status).toBe(400);
  });

  it('preview is metadata-only when exposure is off; text appears (redacted) when on', async () => {
    const off = await start(normalScenario());
    const r1 = await fetch(`${off.base}/api/orcs/${encodeURIComponent('pane:%10')}/preview`, { headers: authed(off.h.token) });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as any;
    expect(b1.preview.exposureEnabled).toBe(false);
    expect(b1.preview.text).toBeUndefined();

    const secret = 'ghp_DDDDDDDDDDDDDDDDDDDD1111';
    const on = await start(normalScenario({ captures: { '%10': `working with ${secret}`, '%11': '$ ' } }), { preview: { exposureEnabled: true, lineCount: 12 } });
    const r2 = await fetch(`${on.base}/api/orcs/${encodeURIComponent('pane:%10')}/preview`, { headers: authed(on.h.token) });
    const b2 = (await r2.json()) as any;
    expect(b2.preview.exposureEnabled).toBe(true);
    expect(Array.isArray(b2.preview.text)).toBe(true);
    expect(JSON.stringify(b2)).not.toContain(secret); // redacted before egress
  });

  it('preview 404 for unknown orc, 400 for malformed orcId', async () => {
    const { base, h } = await start(normalScenario());
    expect((await fetch(`${base}/api/orcs/${encodeURIComponent('pane:%99')}/preview`, { headers: authed(h.token) })).status).toBe(404);
    expect((await fetch(`${base}/api/orcs/bad/preview`, { headers: authed(h.token) })).status).toBe(400);
  });
});

describe('SPEC-101 refresh + method handling (AC-07/13)', () => {
  it('POST /api/refresh requires token; GET-only endpoints reject POST with 405', async () => {
    const { base, h } = await start(normalScenario());
    expect((await fetch(`${base}/api/refresh`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${base}/api/snapshot`, { method: 'POST', headers: authed(h.token) })).status).toBe(405);
  });
});

describe('SPEC-100 CORS + Host (AC-15/19)', () => {
  it('preflight from an allowed dev origin gets CORS headers; a foreign origin is rejected', async () => {
    const { base } = await start(normalScenario());
    const ok = await fetch(`${base}/api/snapshot`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const bad = await fetch(`${base}/api/snapshot`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example.com' } });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('a request with an unexpected Host header is rejected (DNS rebinding defense)', async () => {
    const { h } = await start(normalScenario());
    const good = await rawReq(h.port, 'GET', '/api/health', { Host: `127.0.0.1:${h.port}` });
    expect(good.status).toBe(200);
    const bad = await rawReq(h.port, 'GET', '/api/health', { Host: 'evil.example.com' });
    expect(bad.status).toBe(403);
  });
});

describe('SPEC-100 lifecycle (AC-01/09/12)', () => {
  it('URL is token-bearing and binds loopback; close releases the port', async () => {
    const { h } = await start(normalScenario());
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=.+/);
    expect(h.token.length).toBeGreaterThanOrEqual(20); // ~43 chars base64url (>=128-bit)
    const port = h.port;
    await handles.pop()!.close();
    // port should be re-bindable immediately
    const again = await startServer({ deps: makeDeps(normalScenario()).deps, port, explicitPort: true, runtimeEpoch: 'e2', settings: { scanIntervalS: 5, preview: { exposureEnabled: false, lineCount: 12 } } });
    handles.push(again);
    expect(again.port).toBe(port);
  });
});
