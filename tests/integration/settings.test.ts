/**
 * Integration tests (SPEC-500) — GET/PATCH /api/settings over the real server with a
 * temp configDir. Covers lazy materialize, persistence, strict validation, floor-lock,
 * token gating, robust read, and non-persistence of secrets/tokens.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type ServerHandle } from '../../src/server/serve';
import { makeDeps, type Scenario } from '../helpers/fixture';

const WORK = { sessionId: '$1', sessionName: 'work', windows: 1 };
const CLAUDE = { sessionName: 'work', windowIndex: 1, paneIndex: 0, paneId: '%10', command: 'claude', cwd: '/Users/me/proj', pid: 1001, active: true };
function scenario(over: Partial<Scenario> = {}): Scenario {
  return { sessions: [WORK], panes: [CLAUDE], captures: { '%10': 'work' }, ps: { '1001': 'node claude' }, ...over };
}

const handles: ServerHandle[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (handles.length) await handles.pop()!.close();
  for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  dirs.length = 0;
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'orc-camp-cfg-'));
  dirs.push(d);
  return d;
}
async function start(configDir: string, s: Scenario = scenario()): Promise<{ h: ServerHandle; base: string }> {
  const { deps } = makeDeps(s);
  const h = await startServer({ deps, port: 0, runtimeEpoch: 'set-epoch', configDir, heartbeatMs: 60_000 });
  await h.ready;
  handles.push(h);
  return { h, base: `http://127.0.0.1:${h.port}` };
}
function auth(h: ServerHandle, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${h.token}`, ...extra };
}
const J = async (r: Response): Promise<any> => (await r.json()) as any;

describe('SPEC-500 GET/PATCH (AC-01/02/03/04/13)', () => {
  it('lazy materialize: defaults returned, no file written until first PATCH', async () => {
    const dir = tempDir();
    const { h, base } = await start(dir);
    const g = await J(await fetch(`${base}/api/settings`, { headers: auth(h) }));
    expect(g.scanInterval).toBe(3);
    expect(g.preview).toEqual({ exposureEnabled: true, lineCount: 12 });
    expect(g.redactionEnabled).toBe(true);
    expect(g.bounds.scanInterval).toEqual({ min: 1, max: 5 });
    expect(existsSync(join(dir, 'config.json'))).toBe(false); // lazy

    const p = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: auth(h, { 'Content-Type': 'application/json' }), body: JSON.stringify({ scanInterval: 2 }) });
    expect(p.status).toBe(200);
    expect((await J(p)).scanInterval).toBe(2);
    expect(existsSync(join(dir, 'config.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).scanInterval).toBe(2);

    const g2 = await J(await fetch(`${base}/api/settings`, { headers: auth(h) }));
    expect(g2.scanInterval).toBe(2);
  });

  it('strict validation: out-of-range / floor-lock / unknown → 422, no change', async () => {
    const { h, base } = await start(tempDir());
    for (const [body, code] of [
      [{ scanInterval: 10 }, 'out_of_range'],
      [{ preview: { lineCount: 20 } }, 'out_of_range'],
      [{ redactionEnabled: false }, 'redaction_floor_locked'],
      [{ nope: 1 }, 'unknown_field'],
    ] as const) {
      const r = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: auth(h, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      expect(r.status).toBe(422);
      const e = await J(r);
      expect(e.error.code).toBe('validation_failed');
      expect(e.error.fieldErrors.some((f: any) => f.code === code)).toBe(true);
    }
    expect((await J(await fetch(`${base}/api/settings`, { headers: auth(h) }))).scanInterval).toBe(3); // unchanged
  });

  it('preview exposure+lineCount persist (AC-04)', async () => {
    const { h, base } = await start(tempDir());
    const r = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: auth(h, { 'Content-Type': 'application/json' }), body: JSON.stringify({ preview: { exposureEnabled: false, lineCount: 8 } }) });
    expect(r.status).toBe(200);
    const g = await J(await fetch(`${base}/api/settings`, { headers: auth(h) }));
    expect(g.preview).toEqual({ exposureEnabled: false, lineCount: 8 });
  });
});

describe('SPEC-500 token gating + non-persistence (AC-06/07/10)', () => {
  it('GET and PATCH require a token', async () => {
    const { base } = await start(tempDir());
    expect((await fetch(`${base}/api/settings`)).status).toBe(401);
    expect((await fetch(`${base}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
  });

  it('config.json never contains the token or workspace secrets', async () => {
    const dir = tempDir();
    const { h, base } = await start(dir, scenario({ captures: { '%10': 'pushing ghp_EEEEEEEEEEEEEEEEEEEE2222' } }));
    await fetch(`${base}/api/settings`, { method: 'PATCH', headers: auth(h, { 'Content-Type': 'application/json' }), body: JSON.stringify({ scanInterval: 4 }) });
    const text = readFileSync(join(dir, 'config.json'), 'utf8');
    expect(text).not.toContain(h.token);
    expect(text).not.toContain('ghp_EEEEEEEEEEEEEEEEEEEE2222');
    expect(text).not.toContain('proj'); // no cwd
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['browserAutoOpen', 'configVersion', 'preview', 'redactionEnabled', 'scanInterval']);
  });
});

describe('SPEC-500 robust read (AC-09)', () => {
  it('corrupt config.json → defaults (no crash), file not overwritten on load', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.json'), '{ this is not json');
    const { h, base } = await start(dir);
    expect((await J(await fetch(`${base}/api/settings`, { headers: auth(h) }))).scanInterval).toBe(3); // default
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{ this is not json'); // preserved
  });
  it('out-of-range file value is clamped on load', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ configVersion: 1, scanInterval: 99, preview: { exposureEnabled: true, lineCount: 12 }, redactionEnabled: true, browserAutoOpen: true }));
    const { h, base } = await start(dir);
    expect((await J(await fetch(`${base}/api/settings`, { headers: auth(h) }))).scanInterval).toBe(5); // clamped
  });
});
