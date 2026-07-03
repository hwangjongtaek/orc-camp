/**
 * Unit tests for the SPEC-402 BroadcastService orchestration logic against a fake
 * runtime + control (no server): cap after de-dup, camp resolution, cold start,
 * and the aggregation/severity mapping — the paths the integration suite can't
 * reach with only two in-camp orcs.
 */
import { describe, expect, it } from 'vitest';
import { BroadcastService } from '../../src/server/broadcast';
import type { ControlOutcomeResponse } from '../../src/server/control';

const EXP = (n: string) => ({ paneId: n, tmuxTarget: `work:1.${n.slice(1)}`, command: 'claude', agentType: 'claude-code' });
const target = (n: string) => ({ orcId: `pane:${n}`, expected: EXP(n) });

interface FakeOpts {
  version?: number;
  camp?: { id: string; orcs: { id: string }[] } | null;
  handle?: (orcId: string) => ControlOutcomeResponse;
}
function svc(opts: FakeOpts = {}, maxTargets = 20) {
  const activities: any[] = [];
  const runtime = {
    snapshotVersion: opts.version ?? 5,
    getCamp: () => (opts.camp !== undefined ? opts.camp : { id: 'session:$1', orcs: [{ id: 'pane:%10' }, { id: 'pane:%20' }, { id: 'pane:%30' }] }),
    recordActivity: (a: any) => { const ev = { id: `act:${activities.length + 1}`, ...a }; activities.push(ev); return ev; },
  } as any;
  const control = {
    handle: async (_action: string, orcId: string) => (opts.handle ? opts.handle(orcId) : { status: 200, body: { ok: true, outcome: 'success', auditEventId: 'a' } }),
  } as any;
  return { s: new BroadcastService(runtime, control, () => new Date('2026-07-03T00:00:00Z'), maxTargets), activities };
}
const OK = { input: { text: 'hi' }, confirmed: true };

describe('BroadcastService (SPEC-402)', () => {
  it('over cap (after de-dup) → 422 too_many_targets, no execution', async () => {
    const { s } = svc({}, 1);
    const r = await s.handle('session:$1', { ...OK, targets: [target('%10'), target('%20')] });
    expect(r.status).toBe(422);
    expect((r.body as any).error.code).toBe('too_many_targets');
  });

  it('cold start → 503 snapshot_not_ready', async () => {
    const { s } = svc({ version: 0 });
    const r = await s.handle('session:$1', { ...OK, targets: [target('%10')] });
    expect(r.status).toBe(503);
  });

  it('unknown camp → 404 camp_not_found', async () => {
    const { s } = svc({ camp: null });
    const r = await s.handle('session:$9', { ...OK, targets: [target('%10')] });
    expect(r.status).toBe(404);
  });

  it('severity = warn on partial failure, aggregates per-orc', async () => {
    const { s, activities } = svc({ handle: (orcId) => (orcId === 'pane:%20'
      ? { status: 409, body: { ok: false, error: { code: 'target_mismatch' }, auditEventId: 'x' } }
      : { status: 200, body: { ok: true, outcome: 'success', auditEventId: 'a' } }) });
    const r = await s.handle('session:$1', { ...OK, targets: [target('%10'), target('%20')] });
    const b = r.body as any;
    expect(b).toMatchObject({ successCount: 1, failureCount: 1 });
    const batch = activities.find((e) => e.code === 'control.broadcast');
    expect(batch.severity).toBe('warn');
    expect(batch.detail.perOrc).toEqual([{ orcId: 'pane:%10', ok: true, errorCode: null }, { orcId: 'pane:%20', ok: false, errorCode: 'target_mismatch' }]);
  });

  it('severity = error when all fail', async () => {
    const { activities, s } = svc({ handle: () => ({ status: 410, body: { ok: false, error: { code: 'target_gone' }, auditEventId: 'x' } }) });
    await s.handle('session:$1', { ...OK, targets: [target('%10'), target('%20')] });
    expect(activities.find((e) => e.code === 'control.broadcast').severity).toBe('error');
  });
});
