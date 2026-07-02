/**
 * Unit tests for the SPEC-401 PassthroughService (arm/disarm, exposure gate, rate
 * cap, idle auto-disarm, supersede, and the non-raw batched audit) with a mock
 * runtime. Integration coverage of the HTTP surface lives in control.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassthroughService, type ExpectedTarget } from '../../src/server/passthrough';
import type { SnapshotRuntime } from '../../src/server/runtime';
import type { NewActivity } from '../../src/server/activity';

const EXPECTED: ExpectedTarget = { paneId: '%10', tmuxTarget: 'work:1.0', command: 'claude', agentType: 'claude-code' };
const CLOCK = new Date('2026-07-02T00:00:00.000Z');

function mockRuntime(over: Partial<Record<string, unknown>> = {}): { rt: SnapshotRuntime; activities: NewActivity[] } {
  const activities: NewActivity[] = [];
  const rt = {
    previewExposureEnabled: () => true,
    snapshotVersion: 1,
    getOrc: (orcId: string) => (orcId === 'pane:%10' ? { status: 'active', tmuxTarget: 'work:1.0', paneId: '%10' } : null),
    revalidate: async (paneId: string) => (paneId === '%10' ? { paneId: '%10', tmuxTarget: 'work:1.0', command: 'claude', agentType: 'claude-code' } : null),
    recordActivity: (a: NewActivity) => {
      const ev = { id: `act:${activities.length}`, seq: activities.length, createdAt: CLOCK.toISOString(), source: 'server', ...a };
      activities.push(a);
      return ev;
    },
    ...over,
  } as unknown as SnapshotRuntime;
  return { rt, activities };
}

const svc = (rt: SnapshotRuntime, opts = {}) => new PassthroughService(rt, () => CLOCK, opts);

describe('PassthroughService.arm (SPEC-401 §2.2/§2.3)', () => {
  it('arms an exposed, matching pane and returns an armSessionId', async () => {
    const { rt } = mockRuntime();
    const r = await svc(rt).arm('pane:%10', EXPECTED);
    expect(r.status).toBe(200);
    expect(typeof r.body.armSessionId).toBe('string');
    expect(r.body.idleTimeoutMs).toBeGreaterThan(0);
  });

  it('refuses to arm when exposure is off (D-044, no blind write)', async () => {
    const { rt } = mockRuntime({ previewExposureEnabled: () => false });
    const r = await svc(rt).arm('pane:%10', EXPECTED);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'exposure_off' });
  });

  it('refuses on target drift (409 target_mismatch)', async () => {
    const { rt } = mockRuntime();
    const r = await svc(rt).arm('pane:%10', { ...EXPECTED, command: 'bash' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'target_mismatch' });
  });
});

describe('PassthroughService.authorizeEgress (Observe=no egress + rate cap)', () => {
  it('rejects unknown / mismatched armSessionId as not_armed', () => {
    const { rt } = mockRuntime();
    const s = svc(rt);
    expect(s.authorizeEgress('%10', 'nope')).toEqual({ ok: false, code: 'not_armed' });
  });

  it('enforces the keystroke rate cap within a 1s window', async () => {
    const { rt } = mockRuntime();
    const s = svc(rt, { keystrokeRate: 3 });
    const armSessionId = (await s.arm('pane:%10', EXPECTED)).body.armSessionId as string;
    for (let i = 0; i < 3; i++) {
      const auth = s.authorizeEgress('%10', armSessionId);
      expect(auth.ok).toBe(true);
      if (auth.ok) s.recordKeystroke(auth.session, { action: 'key', key: 'C-a', execOk: true });
    }
    expect(s.authorizeEgress('%10', armSessionId)).toEqual({ ok: false, code: 'rate_limited' });
  });
});

describe('PassthroughService audit (SPEC-401 §2.9 — batched, non-raw)', () => {
  it('disarm flushes one control.passthrough_session with aggregate scalars only', async () => {
    const { rt, activities } = mockRuntime();
    const s = svc(rt);
    const armSessionId = (await s.arm('pane:%10', EXPECTED)).body.armSessionId as string;
    const a1 = s.authorizeEgress('%10', armSessionId);
    if (a1.ok) s.recordKeystroke(a1.session, { action: 'key', key: 'C-a', execOk: true });
    const a2 = s.authorizeEgress('%10', armSessionId);
    if (a2.ok) s.recordKeystroke(a2.session, { action: 'input', redacted: true, execOk: true });

    const r = s.disarm('pane:%10', armSessionId);
    expect(r.status).toBe(200);
    expect(activities).toHaveLength(1);
    const ev = activities[0]!;
    expect(ev.type).toBe('control.passthrough_session');
    expect(ev.detail).toMatchObject({ keystrokeCount: 2, execFailures: 0, inputRedactedFlag: true, reason: 'user_disarm' });
    // never any raw keystroke / literal / key sequence:
    expect(JSON.stringify(ev)).not.toContain('C-a');
    expect(ev.detail?.keyHistogram).toBeUndefined(); // default off (§2.9 Q6)
  });

  it('disarm with a wrong armSessionId → 404 not_armed, no audit', async () => {
    const { rt, activities } = mockRuntime();
    const s = svc(rt);
    await s.arm('pane:%10', EXPECTED);
    const r = s.disarm('pane:%10', 'wrong');
    expect(r.status).toBe(404);
    expect(activities).toHaveLength(0);
  });

  it('a second arm supersedes the first (flushes a superseded audit)', async () => {
    const { rt, activities } = mockRuntime();
    const s = svc(rt);
    await s.arm('pane:%10', EXPECTED);
    await s.arm('pane:%10', EXPECTED);
    expect(activities).toHaveLength(1);
    expect(activities[0]!.detail?.reason).toBe('superseded');
  });

  it('disposeAll flushes live sessions (server shutdown)', async () => {
    const { rt, activities } = mockRuntime();
    const s = svc(rt);
    await s.arm('pane:%10', EXPECTED);
    s.disposeAll();
    expect(activities).toHaveLength(1);
    expect(activities[0]!.detail?.reason).toBe('server_stopping');
  });
});

describe('PassthroughService idle auto-disarm (SPEC-401 §2.6)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('auto-disarms after PASSTHROUGH_IDLE_MS and flushes an idle_timeout audit', async () => {
    const { rt, activities } = mockRuntime();
    const s = svc(rt, { idleMs: 1000 });
    await s.arm('pane:%10', EXPECTED);
    expect(activities).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(activities).toHaveLength(1);
    expect(activities[0]!.detail?.reason).toBe('idle_timeout');
  });
});
