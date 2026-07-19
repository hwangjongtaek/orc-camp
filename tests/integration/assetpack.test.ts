/**
 * SPEC-300 §3.8 / D-054 — the local server serves the OPTIONAL asset pack at /asset-pack/*.
 * Uses the `assetPackDir` override so the test does not depend on an installed pack.
 */
import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type ServerHandle } from '../../src/server/serve';
import { makeDeps, type Scenario } from '../helpers/fixture';
import type { ServerSettings } from '../../src/server/types';

const SCENARIO: Scenario = {
  sessions: [{ sessionId: '$1', sessionName: 'work', windows: 1 }],
  panes: [{ sessionName: 'work', windowIndex: 0, paneIndex: 0, paneId: '%10', command: 'claude', pid: 1001, active: true }],
  captures: { '%10': 'working' },
  ps: { '1001': 'node /opt/claude/cli.js' },
};

const handles: ServerHandle[] = [];
const tmps: string[] = [];
afterEach(async () => {
  while (handles.length) await handles.pop()!.close();
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function makePack(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oc-pack-'));
  tmps.push(dir);
  mkdirSync(join(dir, 'sprites', 'orc'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), '{"id":"orc-camp-default","version":"0.1.0"}');
  writeFileSync(join(dir, 'sprites', 'orc', 'south.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
  return dir;
}

async function start(assetPackDir: string | null): Promise<string> {
  const { deps } = makeDeps(SCENARIO);
  const h = await startServer({
    deps,
    port: 0,
    runtimeEpoch: 'test-epoch',
    assetPackDir,
    dashboardDir: null, // isolate: no dashboard for these tests
    settings: { scanIntervalS: 5, preview: { exposureEnabled: false, lineCount: 12 } } as ServerSettings,
  });
  await h.ready;
  handles.push(h);
  return `http://127.0.0.1:${h.port}`;
}

function req(base: string, path: string, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const u = new URL(base + path);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

describe('SPEC-300/D-054 — /asset-pack serving', () => {
  it('serves manifest.json (no-cache) un-gated (no token)', async () => {
    const base = await start(makePack());
    const r = await req(base, '/asset-pack/manifest.json');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/json');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(JSON.parse(r.body.toString()).id).toBe('orc-camp-default');
  });

  it('serves a sprite png with a shared cache header', async () => {
    const base = await start(makePack());
    const r = await req(base, '/asset-pack/sprites/orc/south.png');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toBe('public, max-age=86400');
    expect(r.body.subarray(0, 4).toString('binary')).toBe('\x89PNG');
  });

  it('404 for a missing asset', async () => {
    const base = await start(makePack());
    expect((await req(base, '/asset-pack/sprites/orc/missing.png')).status).toBe(404);
  });

  it('rejects an encoded path traversal (403)', async () => {
    const base = await start(makePack());
    const r = await req(base, '/asset-pack/..%2f..%2f..%2fetc%2fpasswd');
    expect(r.status).toBe(403);
    expect(r.body.toString()).not.toContain('root:');
  });

  it('non-GET/HEAD verb is 405', async () => {
    const base = await start(makePack());
    expect((await req(base, '/asset-pack/manifest.json', 'DELETE')).status).toBe(405);
  });

  it('no pack (null) → 404 (dashboard degrades to placeholders)', async () => {
    const base = await start(null);
    const r = await req(base, '/asset-pack/manifest.json');
    expect(r.status).toBe(404);
  });
});
