/**
 * SPEC-203 §2.4/§2.5/§2.8 (AC-04/AC-05/AC-10) + SPEC-103 §2.2 — live-view controller lifecycle.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LiveViewController, type LiveViewSend } from '../src/realtime/liveView';
import type { PaneViewSeedPayload } from '../src/types/ws';

function seed(orcId: string, viewSeq = 0): PaneViewSeedPayload {
  return {
    orcId,
    cols: 80,
    rows: 2,
    cursor: null,
    lines: ['x', 'y'],
    capturedAt: '2026-07-02T00:00:00.000Z',
    redacted: false,
    byteClamped: false,
    viewSeq,
  };
}

let sent: LiveViewSend[];
let ctl: LiveViewController;
let clock: number;

beforeEach(() => {
  sent = [];
  clock = 1000;
  ctl = new LiveViewController((f) => sent.push(f), () => clock);
  ctl.onWsOpen();
  ctl.setExposure(true);
});

const types = (): string[] => sent.map((f) => `${f.type}:${f.payload.orcId}`);

describe('attach gating (SPEC-103 invariant ④, AC-04)', () => {
  it('attaches only when desired ∧ exposure ∧ connected ∧ visible', () => {
    ctl.setDesired('pane:%1');
    expect(types()).toEqual(['view.attach:pane:%1']);
  });

  it('exposure off detaches and does NOT attach (gate wins)', () => {
    ctl.setDesired('pane:%1');
    sent = [];
    ctl.setExposure(false);
    expect(types()).toEqual(['view.detach:pane:%1']);
    // re-desiring while gated sends no attach
    ctl.setDesired('pane:%2');
    expect(sent.some((f) => f.type === 'view.attach')).toBe(false);
  });

  it('tab hidden detaches; visible re-attaches (no auto-resume)', () => {
    ctl.setDesired('pane:%1');
    sent = [];
    ctl.setTabVisible(false);
    expect(types()).toEqual(['view.detach:pane:%1']);
    sent = [];
    ctl.setTabVisible(true);
    expect(types()).toEqual(['view.attach:pane:%1']);
  });
});

describe('switching detach→attach (SPEC-203 §2.5, AC-04)', () => {
  it('switching orc sends detach(old) then attach(new)', () => {
    ctl.setDesired('pane:%1');
    sent = [];
    ctl.setDesired('pane:%2');
    expect(types()).toEqual(['view.detach:pane:%1', 'view.attach:pane:%2']);
  });
});

describe('LRU last-screen + exposure precedence (SPEC-203 §2.5, AC-05/AC-10)', () => {
  it('switch-back shows the previous redacted screen immediately, marked stale', () => {
    ctl.setDesired('pane:%1');
    ctl.onSeed(seed('pane:%1'));
    expect(ctl.getSnapshot().screen?.window).toEqual(['x', 'y']);
    expect(ctl.getSnapshot().stale).toBe(false);

    ctl.setDesired('pane:%2'); // %1 stashed to LRU
    ctl.setDesired('pane:%1'); // back before new seed
    const snap = ctl.getSnapshot();
    expect(snap.screen?.window).toEqual(['x', 'y']); // instant from LRU
    expect(snap.stale).toBe(true); // not live
  });

  it('exposure off PURGES the LRU — switch-back renders no cached screen (AC-10)', () => {
    ctl.setDesired('pane:%1');
    ctl.onSeed(seed('pane:%1'));
    ctl.setDesired('pane:%2');
    ctl.setExposure(false); // purge
    expect(ctl.getSnapshot().screen).toBeNull();
    ctl.setExposure(true);
    ctl.setDesired('pane:%1'); // back — cache was purged
    expect(ctl.getSnapshot().screen).toBeNull();
  });
});

describe('frame handling', () => {
  it('gap in viewSeq triggers a re-attach (detach+attach)', () => {
    ctl.setDesired('pane:%1');
    ctl.onSeed(seed('pane:%1'));
    sent = [];
    ctl.onView({ ...seed('pane:%1'), viewSeq: 5, lines: ['z'] } as never);
    expect(types()).toEqual(['view.detach:pane:%1', 'view.attach:pane:%1']);
    expect(ctl.getSnapshot().stale).toBe(true);
  });

  it('pane_view_end reason=pane_gone surfaces the end reason', () => {
    ctl.setDesired('pane:%1');
    ctl.onSeed(seed('pane:%1'));
    ctl.onEnd({ orcId: 'pane:%1', reason: 'pane_gone' });
    expect(ctl.getSnapshot().endReason).toBe('pane_gone');
  });

  it('disconnect keeps the last screen but marks it stale (no loading revert)', () => {
    ctl.setDesired('pane:%1');
    ctl.onSeed(seed('pane:%1'));
    ctl.onWsClose();
    const snap = ctl.getSnapshot();
    expect(snap.connected).toBe(false);
    expect(snap.screen?.window).toEqual(['x', 'y']);
    expect(snap.stale).toBe(true);
  });
});
