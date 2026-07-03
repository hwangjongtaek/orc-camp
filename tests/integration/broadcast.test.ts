/**
 * Integration tests (SPEC-402) — command broadcast over the real server with a FAKE
 * control spawn (never touches live tmux). Covers composed-input-only reuse of the
 * SPEC-400 gate pipeline, N≥2 single confirm, per-orc fresh re-validation + best-
 * effort aggregation, sequential single-writer, camp scope / de-dup / cap, batch
 * audit non-storage, and exposure independence.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type ServerHandle } from '../../src/server/serve';
import { makeDeps, type Scenario } from '../helpers/fixture';
import type { ProcessSpawn, SpawnResult } from '../../src/types';

const WORK = { sessionId: '$1', sessionName: 'work', windows: 1 };
const OTHER = { sessionId: '$2', sessionName: 'other', windows: 1 };
const pane = (over: Record<string, unknown>): any => ({ sessionName: 'work', windowIndex: 1, paneIndex: 0, command: 'claude', cwd: '/Users/me/proj', active: true, ...over });

function twoOrcScenario(over: Partial<Scenario> = {}): Scenario {
  return {
    sessions: [WORK],
    panes: [
      pane({ paneId: '%10', paneIndex: 0, pid: 1001 }),
      pane({ paneId: '%20', paneIndex: 1, pid: 1002 }),
    ],
    captures: { '%10': 'working', '%20': 'working' },
    ps: { '1001': 'node claude', '1002': 'node claude' },
    ...over,
  };
}
const EXP10 = { paneId: '%10', tmuxTarget: 'work:1.0', command: 'claude', agentType: 'claude-code' };
const EXP20 = { paneId: '%20', tmuxTarget: 'work:1.1', command: 'claude', agentType: 'claude-code' };
const t = (orcId: string, expected: any) => ({ orcId, expected });

function fakeControlSpawn(): { spawn: ProcessSpawn; log: { args: string[] }[] } {
  const log: { args: string[] }[] = [];
  const spawn: ProcessSpawn = async (_file, args) => {
    log.push({ args });
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1 } satisfies SpawnResult;
  };
  return { spawn, log };
}

const handles: ServerHandle[] = [];
afterEach(async () => { while (handles.length) await handles.pop()!.close(); });

async function start(s: Scenario, exposure = false): Promise<{ h: ServerHandle; base: string; ctrl: { args: string[] }[] }> {
  const { deps } = makeDeps(s);
  const { spawn, log } = fakeControlSpawn();
  const h = await startServer({ deps, controlSpawn: spawn, port: 0, runtimeEpoch: 'bc', settings: { scanIntervalS: 5, preview: { exposureEnabled: exposure, lineCount: 12 } }, heartbeatMs: 60_000 });
  await h.ready;
  handles.push(h);
  return { h, base: `http://127.0.0.1:${h.port}`, ctrl: log };
}
const bcPath = (campId = 'session:$1'): string => `/api/camps/${encodeURIComponent(campId)}/broadcast`;
function post(base: string, h: ServerHandle, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${h.token}` }, body: JSON.stringify(body) });
}
const J = async (r: Response): Promise<any> => (await r.json()) as any;
const snap = async (base: string, h: ServerHandle): Promise<any> => J(await fetch(`${base}/api/snapshot`, { headers: { Authorization: `Bearer ${h.token}` } }));

describe('SPEC-402 broadcast — composed-input, confirm, sequential (AC-01/02/04)', () => {
  it('N≥2 with confirmed:true → per-orc /input (literal+Enter), sequential, aggregated', async () => {
    const { h, base, ctrl } = await start(twoOrcScenario());
    const r = await post(base, h, bcPath(), { input: { text: 'hi' }, targets: [t('pane:%10', EXP10), t('pane:%20', EXP20)], confirmed: true });
    expect(r.status).toBe(200);
    const b = await J(r);
    expect(b).toMatchObject({ ok: true, campId: 'session:$1', targetCount: 2, successCount: 2, failureCount: 0 });
    expect(b.results.map((x: any) => [x.orcId, x.ok, x.outcome])).toEqual([['pane:%10', true, 'success'], ['pane:%20', true, 'success']]);
    // AC-01/AC-04: composed-input send-keys only, sequential per pane (%10 fully then %20).
    expect(ctrl.map((c) => c.args)).toEqual([
      ['send-keys', '-t', '%10', '-l', '--', 'hi'],
      ['send-keys', '-t', '%10', 'Enter'],
      ['send-keys', '-t', '%20', '-l', '--', 'hi'],
      ['send-keys', '-t', '%20', 'Enter'],
    ]);
    expect(b.batchAuditEventId).toBeTruthy();
  });

  it('N≥2 without confirmed → 422 confirm_required, NO egress', async () => {
    const { h, base, ctrl } = await start(twoOrcScenario());
    const r = await post(base, h, bcPath(), { input: { text: 'hi' }, targets: [t('pane:%10', EXP10), t('pane:%20', EXP20)] });
    expect(r.status).toBe(422);
    expect((await J(r)).error.code).toBe('confirm_required');
    expect(ctrl).toHaveLength(0);
  });

  it('N==1 executes without a broadcast confirm', async () => {
    const { h, base } = await start(twoOrcScenario());
    const r = await post(base, h, bcPath(), { input: { text: 'hi' }, targets: [t('pane:%10', EXP10)] });
    expect(r.status).toBe(200);
    expect(await J(r)).toMatchObject({ targetCount: 1, successCount: 1 });
  });
});

describe('SPEC-402 best-effort + fresh re-validation (AC-03/05/08)', () => {
  it('one target drifts → that orc fails (target_mismatch), others continue', async () => {
    const { h, base, ctrl } = await start(twoOrcScenario());
    const badExp20 = { ...EXP20, command: 'vim' }; // stale — fresh read says claude
    const r = await post(base, h, bcPath(), { input: { text: 'hi' }, targets: [t('pane:%10', EXP10), t('pane:%20', badExp20)], confirmed: true });
    const b = await J(r);
    expect(b).toMatchObject({ targetCount: 2, successCount: 1, failureCount: 1 });
    expect(b.results.find((x: any) => x.orcId === 'pane:%20')).toMatchObject({ ok: false, errorCode: 'target_mismatch', outcome: null });
    expect(b.results.find((x: any) => x.orcId === 'pane:%10')).toMatchObject({ ok: true });
    // %20 got NO egress (revalidation failed before execute); %10 did.
    expect(ctrl.map((c) => c.args[2])).toEqual(['%10', '%10']);
  });
});

describe('SPEC-402 scope / de-dup / cap (AC-07)', () => {
  it('out-of-camp orcId → 422 out_of_camp_scope, NO egress', async () => {
    const { h, base, ctrl } = await start(twoOrcScenario());
    const r = await post(base, h, bcPath(), { input: { text: 'hi' }, targets: [t('pane:%10', EXP10), t('pane:%99', { ...EXP10, paneId: '%99' })], confirmed: true });
    expect(r.status).toBe(422);
    expect((await J(r)).error.code).toBe('out_of_camp_scope');
    expect(ctrl).toHaveLength(0);
  });

  it('duplicate orcId is de-duped → executed once, duplicatesRemoved reported', async () => {
    const { h, base, ctrl } = await start(twoOrcScenario());
    const r = await post(base, h, bcPath(), { input: { text: 'hi' }, targets: [t('pane:%10', EXP10), t('pane:%10', EXP10)], confirmed: true });
    const b = await J(r);
    expect(b).toMatchObject({ targetCount: 1, successCount: 1, duplicatesRemoved: 1 });
    expect(ctrl.filter((c) => c.args.includes('-l'))).toHaveLength(1); // one literal, not two
  });

  // (cap → too_many_targets is unit-tested in tests/unit/broadcast.test.ts with an
  //  injected maxTargets, since >cap distinct in-camp orcs isn't reachable with 2 orcs.)
});

describe('SPEC-402 batch audit non-storage + no new writer (AC-06/09/10)', () => {
  it('control.broadcast batch audit stores scalars only — never the command text', async () => {
    const { h, base } = await start(twoOrcScenario());
    const secret = 'ghp_' + 'A'.repeat(20) + '1234';
    const r = await post(base, h, bcPath(), { input: { text: `run ${secret}` }, targets: [t('pane:%10', EXP10), t('pane:%20', EXP20)], confirmed: true });
    const b = await J(r);
    const s = await snap(base, h);
    const ev = s.recentActivity.find((e: any) => e.id === b.batchAuditEventId);
    expect(ev.type).toBe('control.result');
    expect(ev.code).toBe('control.broadcast');
    expect(ev.target).toEqual({ campId: 'session:$1' });
    expect(ev.detail).toMatchObject({ action: 'broadcast', targetCount: 2, successCount: 2, failureCount: 0, inputRedactedFlag: true });
    expect(ev.detail.perOrc).toEqual([{ orcId: 'pane:%10', ok: true, errorCode: null }, { orcId: 'pane:%20', ok: true, errorCode: null }]);
    // non-storage: the secret must not appear anywhere in the audit event or response.
    const blob = JSON.stringify(ev) + JSON.stringify(b);
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain('run ');
  });

  it('unknown field → 422 validation_error (no free-command field)', async () => {
    const { h, base, ctrl } = await start(twoOrcScenario());
    const r = await post(base, h, bcPath(), { input: { text: 'hi' }, targets: [t('pane:%10', EXP10)], cmd: 'rm -rf' });
    expect(r.status).toBe(422);
    expect((await J(r)).error.code).toBe('validation_error');
    expect(ctrl).toHaveLength(0);
  });

  it('exposure OFF does not block broadcast (form-path semantics, AC-10)', async () => {
    const { h, base } = await start(twoOrcScenario(), false); // exposure off
    const r = await post(base, h, bcPath(), { input: { text: 'hi' }, targets: [t('pane:%10', EXP10)] });
    expect(r.status).toBe(200);
    expect(await J(r)).toMatchObject({ successCount: 1 });
  });
});
