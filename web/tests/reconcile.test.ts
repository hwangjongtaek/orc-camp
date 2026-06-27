import { describe, it, expect } from 'vitest';
import { applyChanges, decideOutcome } from '../src/realtime/reconcile';
import { fromSnapshot, selectCamp } from '../src/store/serverData';
import type { DiffEvent } from '../src/types/ws';
import { makeCamp, makeOrc, makeScan } from './fixtures';

describe('decideOutcome (SPEC-200 §2.5 / AC-04)', () => {
  const base = { runtimeEpoch: 'ep1', lastVersionApplied: 5 };

  it('drops versions <= Vlast (idempotent no-op)', () => {
    expect(decideOutcome({ ...base, version: 5, frameEpoch: 'ep1' })).toBe('dropped');
    expect(decideOutcome({ ...base, version: 3, frameEpoch: 'ep1' })).toBe('dropped');
  });

  it('applies version === Vlast+1', () => {
    expect(decideOutcome({ ...base, version: 6, frameEpoch: 'ep1' })).toBe('applied');
  });

  it('requires resync on a forward gap', () => {
    expect(decideOutcome({ ...base, version: 8, frameEpoch: 'ep1' })).toBe('resync-required');
  });

  it('requires resync on runtimeEpoch mismatch (server restart)', () => {
    expect(decideOutcome({ ...base, version: 6, frameEpoch: 'ep2' })).toBe('resync-required');
  });
});

describe('fromSnapshot normalization', () => {
  it('normalizes camps/orcs into id maps and sorts camps by tmuxSessionName', () => {
    const scan = makeScan({
      camps: [
        makeCamp({ sessionId: '$1', tmuxSessionName: 'zeta', orcs: [makeOrc({ paneId: '%2' })] }),
        makeCamp({ sessionId: '$0', tmuxSessionName: 'alpha', orcs: [makeOrc({ paneId: '%1' })] }),
      ],
    });
    const server = fromSnapshot(scan, 1);
    expect(server.campIds).toEqual(['session:$0', 'session:$1']); // alpha < zeta
    expect(Object.keys(server.orcsById).sort()).toEqual(['pane:%1', 'pane:%2']);
    expect(server.orcIdsByCamp['session:$1']).toEqual(['pane:%2']);
  });
});

describe('applyChanges id-merge (SPEC-200 §2.5 / AC-05)', () => {
  function baseServer() {
    const scan = makeScan({
      camps: [
        makeCamp({
          sessionId: '$0',
          tmuxSessionName: 'work',
          orcs: [makeOrc({ paneId: '%1', status: 'idle', statusConfidence: 0.6 })],
        }),
      ],
    });
    return fromSnapshot(scan, 1);
  }

  it('merges orc_status_changed by stable id', () => {
    const ev: DiffEvent = {
      type: 'orc_status_changed',
      payload: {
        campId: 'session:$0',
        orcId: 'pane:%1',
        status: 'active',
        statusConfidence: 0.92,
        statusSignals: [],
        currentWorkSummary: 'building',
        summarySource: 'recent_output',
        summaryIsEstimated: true,
        lastActivityAt: '2026-06-27T00:01:00.000Z',
      },
    };
    const res = applyChanges(baseServer(), [ev], 2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.next.snapshotVersion).toBe(2);
    const orc = res.next.orcsById['pane:%1'];
    expect(orc?.status).toBe('active');
    expect(orc?.statusConfidence).toBe(0.92);
  });

  it('is convergent: applying the same batch twice yields the same state (no dup ids)', () => {
    const ev: DiffEvent = {
      type: 'orc_added',
      payload: { campId: 'session:$0', data: makeOrc({ paneId: '%2', paneIndex: 1 }) },
    };
    const first = applyChanges(baseServer(), [ev], 2);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyChanges(first.next, [ev], 3);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.next.orcIdsByCamp['session:$0']).toEqual(['pane:%1', 'pane:%2']);
    expect(Object.keys(second.next.orcsById).sort()).toEqual(['pane:%1', 'pane:%2']);
  });

  it('adds and removes a camp', () => {
    const add: DiffEvent = {
      type: 'camp_added',
      payload: { data: makeCamp({ sessionId: '$1', tmuxSessionName: 'aaa', orcs: [makeOrc({ paneId: '%9' })] }) },
    };
    const added = applyChanges(baseServer(), [add], 2);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.next.campIds).toEqual(['session:$1', 'session:$0']); // aaa < work
    expect(selectCamp(added.next, 'session:$1')?.orcs.length).toBe(1);

    const remove: DiffEvent = { type: 'camp_removed', payload: { campId: 'session:$1' } };
    const removed = applyChanges(added.next, [remove], 3);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.next.campIds).toEqual(['session:$0']);
    expect(removed.next.orcsById['pane:%9']).toBeUndefined();
  });

  it('returns {ok:false} (resync) on an unknown-id reference, without partial mutation', () => {
    const ev: DiffEvent = {
      type: 'orc_status_changed',
      payload: {
        campId: 'session:$0',
        orcId: 'pane:%999',
        status: 'active',
        statusConfidence: 1,
        statusSignals: [],
        currentWorkSummary: null,
        summarySource: 'unknown',
        summaryIsEstimated: true,
        lastActivityAt: '2026-06-27T00:01:00.000Z',
      },
    };
    const before = baseServer();
    const res = applyChanges(before, [ev], 2);
    expect(res.ok).toBe(false);
    // original untouched
    expect(before.orcsById['pane:%1']?.status).toBe('idle');
  });
});
