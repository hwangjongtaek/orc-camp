/**
 * Integration tests (SPEC-400) — control actions over the real server with a FAKE
 * control spawn (never touches live tmux). Covers the write-path templates, key
 * allowlist, interrupt confirm, token gate, fresh target re-validation (mismatch/
 * gone), audit event, and input-text non-persistence.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type ServerHandle } from '../../src/server/serve';
import { makeDeps, type Scenario } from '../helpers/fixture';
import type { ProcessSpawn, SpawnResult } from '../../src/types';

const WORK = { sessionId: '$1', sessionName: 'work', windows: 1 };
function claudePane(over: Record<string, unknown> = {}): any {
  return { sessionName: 'work', windowIndex: 1, paneIndex: 0, paneId: '%10', command: 'claude', cwd: '/Users/me/proj', pid: 1001, active: true, ...over };
}
function scenario(over: Partial<Scenario> = {}): Scenario {
  return { sessions: [WORK], panes: [claudePane()], captures: { '%10': 'working' }, ps: { '1001': 'node claude' }, ...over };
}
const EXPECTED = { paneId: '%10', tmuxTarget: 'work:1.0', command: 'claude', agentType: 'claude-code' };

function fakeControlSpawn(): { spawn: ProcessSpawn; log: { file: string; args: string[] }[] } {
  const log: { file: string; args: string[] }[] = [];
  const spawn: ProcessSpawn = async (file, args) => {
    log.push({ file, args });
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1 } satisfies SpawnResult;
  };
  return { spawn, log };
}

const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length) await handles.pop()!.close();
});

async function start(s: Scenario): Promise<{ h: ServerHandle; base: string; ctrl: { file: string; args: string[] }[] }> {
  const { deps } = makeDeps(s);
  const { spawn, log } = fakeControlSpawn();
  const h = await startServer({ deps, controlSpawn: spawn, port: 0, runtimeEpoch: 'ctl', settings: { scanIntervalS: 5, preview: { exposureEnabled: false, lineCount: 12 } }, heartbeatMs: 60_000 });
  await h.ready;
  handles.push(h);
  return { h, base: `http://127.0.0.1:${h.port}`, ctrl: log };
}
function post(base: string, h: ServerHandle, path: string, body: unknown, withToken = true): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(withToken ? { Authorization: `Bearer ${h.token}` } : {}) }, body: JSON.stringify(body) });
}
const orcPath = (action: string): string => `/api/orcs/${encodeURIComponent('pane:%10')}/${action}`;
const J = async (r: Response): Promise<any> => (await r.json()) as any;
const sendKeys = (ctrl: { args: string[] }[]): string[][] => ctrl.map((c) => c.args);

describe('SPEC-400 send-keys templates (AC-01/02)', () => {
  it('input literal text then Enter, to the stable paneId only', async () => {
    const { h, base, ctrl } = await start(scenario());
    const r = await post(base, h, orcPath('input'), { text: 'hello', submit: true, expected: EXPECTED });
    expect(r.status).toBe(200);
    const b = await J(r);
    expect(b.outcome).toBe('success');
    expect(b.auditEventId).toBeTruthy();
    expect(sendKeys(ctrl)).toEqual([
      ['send-keys', '-t', '%10', '-l', '--', 'hello'],
      ['send-keys', '-t', '%10', 'Enter'],
    ]);
    expect(ctrl.every((c) => c.file === 'tmux' && c.args[0] === 'send-keys')).toBe(true);
  });

  it('metacharacter text is sent literally (-l --), not interpreted', async () => {
    const { h, base, ctrl } = await start(scenario());
    await post(base, h, orcPath('input'), { text: 'C-c $(reboot)', submit: false, expected: EXPECTED });
    expect(ctrl[0]!.args).toEqual(['send-keys', '-t', '%10', '-l', '--', 'C-c $(reboot)']);
    expect(ctrl).toHaveLength(1); // no Enter (submit:false)
  });
});

describe('SPEC-400 key allowlist + interrupt confirm (AC-03/04)', () => {
  it('allowlisted key sends; non-allowlisted key → 422 key_not_allowed, no spawn', async () => {
    const { h, base, ctrl } = await start(scenario());
    expect((await post(base, h, orcPath('key'), { key: 'Enter', expected: EXPECTED })).status).toBe(200);
    expect(ctrl.at(-1)!.args).toEqual(['send-keys', '-t', '%10', 'Enter']);
    const bad = await post(base, h, orcPath('key'), { key: 'C-d', expected: EXPECTED });
    expect(bad.status).toBe(422);
    expect((await J(bad)).error.code).toBe('key_not_allowed');
    expect(ctrl).toHaveLength(1); // C-d never spawned
  });

  it('interrupt requires confirmed:true (AC-04)', async () => {
    const { h, base, ctrl } = await start(scenario());
    const noConfirm = await post(base, h, orcPath('interrupt'), { expected: EXPECTED });
    expect(noConfirm.status).toBe(422);
    expect((await J(noConfirm)).error.code).toBe('confirm_required');
    expect(ctrl).toHaveLength(0);
    const ok = await post(base, h, orcPath('interrupt'), { confirmed: true, expected: EXPECTED });
    expect(ok.status).toBe(200);
    expect(ctrl.at(-1)!.args).toEqual(['send-keys', '-t', '%10', 'C-c']);
  });
});

describe('SPEC-400 token gate (AC-05)', () => {
  it('control without a token is 401 and never spawns', async () => {
    const { h, base, ctrl } = await start(scenario());
    expect((await post(base, h, orcPath('input'), { text: 'x', expected: EXPECTED }, false)).status).toBe(401);
    expect(ctrl).toHaveLength(0);
  });
});

describe('SPEC-400 fresh re-validation (AC-06/07)', () => {
  it('target_mismatch (foreground command drifted) aborts with no spawn + audit', async () => {
    const s = scenario();
    const { h, base, ctrl } = await start(s);
    s.panes![0]!.command = 'bash'; // fresh read will now see a different command
    const r = await post(base, h, orcPath('input'), { text: 'x', expected: EXPECTED });
    expect(r.status).toBe(409);
    const b = await J(r);
    expect(b.error.code).toBe('target_mismatch');
    expect(b.auditEventId).toBeTruthy();
    expect(ctrl).toHaveLength(0);
  });

  it('target_gone (pane disappeared) aborts with no spawn', async () => {
    const s = scenario();
    const { h, base, ctrl } = await start(s);
    s.panes = []; // pane gone in fresh read
    const r = await post(base, h, orcPath('input'), { text: 'x', expected: EXPECTED });
    expect([404, 410]).toContain(r.status); // gone in snapshot or in fresh read
    expect(ctrl).toHaveLength(0);
  });
});

async function startPt(s: Scenario): Promise<{ h: ServerHandle; base: string; ctrl: { file: string; args: string[] }[] }> {
  const { deps } = makeDeps(s);
  const { spawn, log } = fakeControlSpawn();
  const h = await startServer({ deps, controlSpawn: spawn, port: 0, runtimeEpoch: 'ctl', settings: { scanIntervalS: 5, preview: { exposureEnabled: true, lineCount: 12 } }, heartbeatMs: 60_000 });
  await h.ready;
  handles.push(h);
  return { h, base: `http://127.0.0.1:${h.port}`, ctrl: log };
}
const ptArm = `/api/orcs/${encodeURIComponent('pane:%10')}/passthrough/arm`;
const ptDisarm = `/api/orcs/${encodeURIComponent('pane:%10')}/passthrough/disarm`;

describe('SPEC-400 §2.3.1 literal control-byte filter (AC-20)', () => {
  it('rejects control bytes in literal /input (422 control_char_not_allowed, no spawn)', async () => {
    const { h, base, ctrl } = await start(scenario());
    for (const text of ['a\u0003b', 'x\u000ay', 'z\u001b', 'q\u007f']) {
      const r = await post(base, h, orcPath('input'), { text, submit: false, expected: EXPECTED });
      expect(r.status).toBe(422);
      expect((await J(r)).error.code).toBe('control_char_not_allowed');
    }
    expect(ctrl).toHaveLength(0); // the confirm-gate bypass is closed
  });
});

describe('SPEC-401 passthrough (AC via server)', () => {
  it('form /key rejects interactive chords (base allowlist only)', async () => {
    const { h, base, ctrl } = await start(scenario());
    const r = await post(base, h, orcPath('key'), { key: 'C-a', expected: EXPECTED });
    expect(r.status).toBe(422);
    expect((await J(r)).error.code).toBe('key_not_allowed');
    expect(ctrl).toHaveLength(0);
  });

  it('arm requires exposure on (409 exposure_off when off)', async () => {
    const { h, base } = await start(scenario()); // exposure off
    const r = await post(base, h, ptArm, { expected: EXPECTED });
    expect(r.status).toBe(409);
    expect((await J(r)).error.code).toBe('exposure_off');
  });

  it('Observe = no egress: passthrough marker without a live arm-session → 409 not_armed, no spawn', async () => {
    const { h, base, ctrl } = await startPt(scenario());
    const r = await post(base, h, orcPath('key'), { key: 'C-a', passthrough: { armSessionId: 'bogus' } });
    expect(r.status).toBe(409);
    expect((await J(r)).error.code).toBe('not_armed');
    expect(ctrl).toHaveLength(0);
  });

  it('arm → interactive /key egress (single writer) → disarm flushes a non-raw session audit', async () => {
    const { h, base, ctrl } = await startPt(scenario());
    const arm = await post(base, h, ptArm, { expected: EXPECTED });
    expect(arm.status).toBe(200);
    const armSessionId = (await J(arm)).armSessionId as string;
    expect(armSessionId).toBeTruthy();

    // interactive chord allowed only via armed passthrough; sent by the single writer.
    const k = await post(base, h, orcPath('key'), { key: 'C-a', passthrough: { armSessionId } });
    expect(k.status).toBe(200);
    expect(ctrl.at(-1)!.args).toEqual(['send-keys', '-t', '%10', 'C-a']);
    // literal passthrough: no Enter appended (submit forced false)
    await post(base, h, orcPath('input'), { text: 'hello', passthrough: { armSessionId } });
    expect(ctrl.at(-1)!.args).toEqual(['send-keys', '-t', '%10', '-l', '--', 'hello']);

    const disarm = await post(base, h, ptDisarm, { armSessionId });
    expect(disarm.status).toBe(200);
    const auditId = (await J(disarm)).auditEventId as string;

    const snap = await J(await fetch(`${base}/api/snapshot`, { headers: { Authorization: `Bearer ${h.token}` } }));
    const ev = snap.recentActivity.find((e: any) => e.id === auditId);
    expect(ev.type).toBe('control.passthrough_session');
    expect(ev.detail.keystrokeCount).toBe(2);
    expect(ev.detail.reason).toBe('user_disarm');
    expect(typeof ev.detail.durationMs).toBe('number');
    // no raw keystrokes / literal text / key sequence anywhere in the event
    expect(JSON.stringify(ev)).not.toContain('hello');
    expect(JSON.stringify(ev)).not.toContain('C-a');
    // per-keystroke control.result events are NOT emitted
    expect(snap.recentActivity.some((e: any) => e.type === 'control.result')).toBe(false);
  });

  it('passthrough literal inherits the control-byte filter', async () => {
    const { h, base, ctrl } = await startPt(scenario());
    const armSessionId = (await J(await post(base, h, ptArm, { expected: EXPECTED }))).armSessionId as string;
    const r = await post(base, h, orcPath('input'), { text: 'x', passthrough: { armSessionId } });
    expect(r.status).toBe(422);
    expect((await J(r)).error.code).toBe('control_char_not_allowed');
    expect(ctrl).toHaveLength(0);
  });
});

describe('SPEC-400 audit + non-persistence (AC-12/13)', () => {
  it('a control.result event is recorded; input text/secret is never stored', async () => {
    const secret = 'ghp_GGGGGGGGGGGGGGGGGGGG7777';
    const { h, base } = await start(scenario());
    const r = await post(base, h, orcPath('input'), { text: `deploy ${secret}`, submit: false, expected: EXPECTED });
    const auditId = (await J(r)).auditEventId;
    const snap = await J(await fetch(`${base}/api/snapshot`, { headers: { Authorization: `Bearer ${h.token}` } }));
    const event = snap.recentActivity.find((e: any) => e.id === auditId);
    expect(event.type).toBe('control.result');
    expect(event.detail.action).toBe('input');
    expect(event.detail.controlOutcome).toBe('success');
    expect(event.detail.inputByteLength).toBe(Buffer.byteLength(`deploy ${secret}`, 'utf8'));
    expect(event.detail.inputRedactedFlag).toBe(true);
    expect(JSON.stringify(event)).not.toContain(secret); // text never serialized
  });
});
