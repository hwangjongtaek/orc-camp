/**
 * SPEC-700 §2.3 / AC-03, AC-06 — the local server serves the built dashboard SPA from
 * a static root (single self-contained installable), and falls back to the placeholder
 * shell when no build is present (dev). Uses the `dashboardDir` override so the test does
 * not depend on a real `dist/dashboard/` build.
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

function makeDashboard(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oc-dash-'));
  tmps.push(dir);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><div id="root"></div><script src="/assets/app-abcd1234.js"></script></body></html>');
  writeFileSync(join(dir, 'assets', 'app-abcd1234.js'), 'console.log("orc-camp");');
  writeFileSync(join(dir, 'assets', 'style-9f9f.css'), 'body{color:#000}');
  return dir;
}

async function start(dashboardDir: string | null): Promise<string> {
  const { deps } = makeDeps(SCENARIO);
  const h = await startServer({
    deps,
    port: 0,
    runtimeEpoch: 'test-epoch',
    dashboardDir,
    settings: { scanIntervalS: 5, preview: { exposureEnabled: false, lineCount: 12 } } as ServerSettings,
  });
  await h.ready;
  handles.push(h);
  return `http://127.0.0.1:${h.port}`;
}

function req(base: string, path: string, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const u = new URL(base + path);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    r.end();
  });
}

describe('SPEC-700 AC-03 — server serves the built dashboard', () => {
  it('GET / returns index.html (no token needed for the shell)', async () => {
    const base = await start(makeDashboard());
    const r = await req(base, '/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('id="root"');
    expect(r.headers['cache-control']).toBe('no-cache'); // shell must revalidate
  });

  it('serves a hashed asset with an immutable cache header', async () => {
    const base = await start(makeDashboard());
    const r = await req(base, '/assets/app-abcd1234.js');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/javascript');
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.body).toContain('orc-camp');
  });

  it('falls back to index.html for an extensionless client route (SPA)', async () => {
    const base = await start(makeDashboard());
    const r = await req(base, '/camps/session:%241');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('id="root"');
  });

  it('returns 404 for a missing asset (has extension)', async () => {
    const base = await start(makeDashboard());
    const r = await req(base, '/assets/missing-0000.js');
    expect(r.status).toBe(404);
  });

  it('rejects an encoded path-traversal attempt (%2f separators survive URL parsing)', async () => {
    const base = await start(makeDashboard());
    // %2f stays encoded through URL parsing and only becomes '/' when the handler decodes
    // it, so this genuinely exercises the server-side traversal guard (not URL normalization).
    const r = await req(base, '/assets/..%2f..%2f..%2f..%2fetc%2fpasswd');
    expect(r.status).toBe(403);
    expect(r.body).not.toContain('root:'); // never leaks /etc/passwd
  });

  it('a non-GET/HEAD verb on a static path is 405', async () => {
    const base = await start(makeDashboard());
    const r = await req(base, '/', 'DELETE');
    expect(r.status).toBe(405);
  });

  it('AC-06: with no built dashboard, GET / serves the placeholder shell (dev parity)', async () => {
    const base = await start(null);
    const r = await req(base, '/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('Orc Camp');
    // an unknown route with no build is a 404 (no SPA to fall back to)
    const miss = await req(base, '/camps/x');
    expect(miss.status).toBe(404);
  });

  it('the API stays token-gated even though the shell is public', async () => {
    const base = await start(makeDashboard());
    const r = await req(base, '/api/snapshot');
    expect(r.status).toBe(401);
  });
});
