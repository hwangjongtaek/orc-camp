/**
 * Unit tests for the SPEC-103 live pane-view runtime (src/server/pane-view.ts):
 * the read-only capturer (capturePaneView) and the per-connection attach session
 * (PaneViewSession) with a mock host + injected timer (deterministic, no real time).
 */
import { describe, expect, it } from 'vitest';
import { sanitizeCapture } from '../../src/redaction/redact';
import type { SpawnResult, TmuxExecFn } from '../../src/types';
import {
  capturePaneView,
  PaneViewSession,
  type LiveViewHost,
  type PaneViewCapture,
} from '../../src/server/pane-view';

const ok = (stdout: string): SpawnResult => ({ stdout, stderr: '', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1 });
const fail = (): SpawnResult => ({ stdout: '', stderr: 'x', exitCode: 1, timedOut: false, spawnError: null, durationMs: 1 });

// ── capturePaneView ──────────────────────────────────────────────────────────────

function tmuxWith(geomRows: string, captureText: string, opts: { lpFail?: boolean; capFail?: boolean } = {}): TmuxExecFn {
  return async (sub, _args) => {
    if (sub === 'list-panes') return opts.lpFail ? fail() : ok(geomRows);
    if (sub === 'capture-pane') return opts.capFail ? fail() : ok(captureText);
    return fail();
  };
}

describe('capturePaneView (SPEC-103 §2.5)', () => {
  const deps = (tmuxExec: TmuxExecFn) => ({ tmuxExec, sanitize: sanitizeCapture });

  it('returns ok with geometry, visible cursor, and redacted lines', async () => {
    const r = await capturePaneView(deps(tmuxWith('%10 120 40 5 7 1 0\n', 'line1\nline2\n')), '%10');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ cols: 120, rows: 40, cursor: { x: 5, y: 7 }, byteClamped: false });
    expect(r.lines).toEqual(['line1', 'line2', '']); // trailing '' from the final \n (splitLF)
  });

  it('picks the target row by pane_id in a multi-pane window', async () => {
    const rows = '%11 80 24 0 0 1 0\n%10 100 30 9 1 1 0\n';
    const r = await capturePaneView(deps(tmuxWith(rows, 'hi\n')), '%10');
    expect(r.ok && r.cols).toBe(100);
    expect(r.ok && r.cursor).toEqual({ x: 9, y: 1 });
  });

  it('cursor_flag=0 → cursor null (hidden), no separate field', async () => {
    const r = await capturePaneView(deps(tmuxWith('%10 80 24 3 3 0 0\n', 'x\n')), '%10');
    expect(r.ok && r.cursor).toBeNull();
  });

  it('no matching row → gone', async () => {
    const r = await capturePaneView(deps(tmuxWith('%11 80 24 0 0 1 0\n', 'x\n')), '%10');
    expect(r).toEqual({ ok: false, kind: 'gone' });
  });

  it('list-panes failure → failed; capture-pane failure → failed', async () => {
    expect(await capturePaneView(deps(tmuxWith('', '', { lpFail: true })), '%10')).toEqual({ ok: false, kind: 'failed' });
    expect(await capturePaneView(deps(tmuxWith('%10 80 24 0 0 1 0\n', '', { capFail: true })), '%10')).toEqual({ ok: false, kind: 'failed' });
  });

  it('redacts secrets in captured lines (redaction-before-egress)', async () => {
    const r = await capturePaneView(deps(tmuxWith('%10 80 24 0 0 1 0\n', 'export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n')), '%10');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.redacted).toBe(true);
    expect(r.lines.join('\n')).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    expect(r.lines.join('\n')).toContain('[REDACTED');
  });
});

// ── PaneViewSession ────────────────────────────────────────────────────────────

type Frame = { type: string; payload: any };

const okCap = (over: Partial<Extract<PaneViewCapture, { ok: true }>> = {}): PaneViewCapture => ({
  ok: true, cols: 80, rows: 24, cursor: { x: 0, y: 0 }, lines: ['a'], redacted: false, byteClamped: false, ...over,
});

function harness(hostOver: Partial<LiveViewHost> = {}) {
  const frames: Frame[] = [];
  let scheduled: (() => void) | null = null;
  const host: LiveViewHost = {
    resolvePaneId: (orcId) => (orcId === 'pane:%10' ? '%10' : orcId === 'pane:%20' ? '%20' : null),
    exposureEnabled: () => true,
    capture: async () => okCap(),
    now: () => new Date('2026-07-02T00:00:00.000Z'),
    ...hostOver,
  };
  const session = new PaneViewSession(host, (type, payload) => frames.push({ type, payload }), {
    setTimer: (fn) => {
      scheduled = fn;
      return { clear: () => { scheduled = null; } };
    },
  });
  const runTick = async (): Promise<void> => {
    const fn = scheduled;
    scheduled = null;
    if (fn) fn();
    await new Promise((r) => setImmediate(r)); // drain the async tick
  };
  const hasPending = (): boolean => scheduled !== null;
  return { frames, session, runTick, hasPending };
}

describe('PaneViewSession (SPEC-103 §2.2/§2.3/§3)', () => {
  it('attach → seed(viewSeq=0) then polling frames with strict +1 viewSeq', async () => {
    const { frames, session, runTick } = harness();
    await session.onAttach('pane:%10');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'pane_view_seed', payload: { orcId: 'pane:%10', viewSeq: 0, cols: 80, rows: 24 } });

    await runTick();
    await runTick();
    expect(frames.map((f) => f.type)).toEqual(['pane_view_seed', 'pane_view', 'pane_view']);
    expect(frames[1]?.payload.viewSeq).toBe(1);
    expect(frames[2]?.payload.viewSeq).toBe(2);
  });

  it('attach unknown orc → pane_view_end pane_gone (no seed)', async () => {
    const { frames, session } = harness();
    await session.onAttach('pane:%99');
    expect(frames).toEqual([{ type: 'pane_view_end', payload: { orcId: 'pane:%99', reason: 'pane_gone' } }]);
  });

  it('attach while exposure off → pane_view_end exposure_off', async () => {
    const { frames, session } = harness({ exposureEnabled: () => false });
    await session.onAttach('pane:%10');
    expect(frames).toEqual([{ type: 'pane_view_end', payload: { orcId: 'pane:%10', reason: 'exposure_off' } }]);
  });

  it('exposure turns off mid-stream → pane_view_end exposure_off, polling stops', async () => {
    let exposed = true;
    const { frames, session, runTick, hasPending } = harness({ exposureEnabled: () => exposed });
    await session.onAttach('pane:%10');
    exposed = false;
    await runTick();
    expect(frames.at(-1)).toEqual({ type: 'pane_view_end', payload: { orcId: 'pane:%10', reason: 'exposure_off' } });
    expect(hasPending()).toBe(false);
  });

  it('pane vanishes mid-stream → pane_view_end pane_gone', async () => {
    let cap: PaneViewCapture = okCap();
    const { frames, session, runTick } = harness({ capture: async () => cap });
    await session.onAttach('pane:%10');
    cap = { ok: false, kind: 'gone' };
    await runTick();
    expect(frames.at(-1)).toEqual({ type: 'pane_view_end', payload: { orcId: 'pane:%10', reason: 'pane_gone' } });
  });

  it('transient failures skip frames, then end(error) at the cap (default 3)', async () => {
    let cap: PaneViewCapture = okCap();
    const { frames, session, runTick } = harness({ capture: async () => cap });
    await session.onAttach('pane:%10'); // seed
    cap = { ok: false, kind: 'failed' };
    await runTick(); // fail #1 (no frame)
    await runTick(); // fail #2 (no frame)
    expect(frames.map((f) => f.type)).toEqual(['pane_view_seed']);
    await runTick(); // fail #3 → error
    expect(frames.at(-1)).toEqual({ type: 'pane_view_end', payload: { orcId: 'pane:%10', reason: 'error' } });
  });

  it('attach to a different orc supersedes the previous (≤1 attach)', async () => {
    const { frames, session } = harness();
    await session.onAttach('pane:%10');
    await session.onAttach('pane:%20');
    expect(frames.map((f) => `${f.type}:${f.payload.orcId}:${f.payload.reason ?? f.payload.viewSeq}`)).toEqual([
      'pane_view_seed:pane:%10:0',
      'pane_view_end:pane:%10:superseded',
      'pane_view_seed:pane:%20:0',
    ]);
  });

  it('detach matching → end(detached); non-matching → no-op', async () => {
    const { frames, session } = harness();
    await session.onAttach('pane:%10');
    session.onDetach('pane:%20'); // no-op
    session.onDetach('pane:%10');
    expect(frames.map((f) => f.type)).toEqual(['pane_view_seed', 'pane_view_end']);
    expect(frames.at(-1)).toEqual({ type: 'pane_view_end', payload: { orcId: 'pane:%10', reason: 'detached' } });
  });

  it('dispose stops polling silently (no frame, no pending timer)', async () => {
    const { frames, session, runTick, hasPending } = harness();
    await session.onAttach('pane:%10');
    session.dispose();
    expect(hasPending()).toBe(false);
    await runTick();
    expect(frames.map((f) => f.type)).toEqual(['pane_view_seed']); // nothing after dispose
  });
});
