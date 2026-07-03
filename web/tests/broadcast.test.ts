/**
 * SPEC-402 client + SPEC-203 §2.10 — pure broadcast helpers: target/row build (client-side selection,
 * camp order, de-dup), bulk presets (current-camp status class), batch severity mapping (§2.7), the
 * summary line, and request-level error copy.
 */
import { describe, it, expect } from 'vitest';
import {
  broadcastErrorMessage,
  broadcastSeverity,
  buildRows,
  buildTargets,
  bulkSelect,
  summarizeBroadcast,
} from '../src/terminal/broadcast';
import { makeOrc } from './fixtures';
import type { Orc } from '../src/types/domain';
import type { BroadcastResult } from '../src/types/api';

function byId(orcs: Orc[]): Record<string, Orc> {
  const m: Record<string, Orc> = {};
  for (const o of orcs) m[o.id] = o;
  return m;
}

describe('buildTargets / buildRows (AC-18 i, SPEC-402 §2.1)', () => {
  const orcs = [
    makeOrc({ paneId: '%1', tmuxTarget: 'work:0.0', command: 'claude', status: 'active' }),
    makeOrc({ paneId: '%2', tmuxTarget: 'infra:1.2', command: 'codex', status: 'waiting' }),
    makeOrc({ paneId: '%3', tmuxTarget: 'db:0.1', command: 'psql', status: 'idle' }),
  ];
  const ordered = ['pane:%1', 'pane:%2', 'pane:%3'];
  const map = byId(orcs);

  it('includes only selected orcs, in camp order, each with its expected 4-tuple', () => {
    const targets = buildTargets(ordered, new Set(['pane:%3', 'pane:%1']), map);
    expect(targets.map((t) => t.orcId)).toEqual(['pane:%1', 'pane:%3']); // camp order, not selection order
    expect(targets[0]!.expected).toEqual({ paneId: '%1', tmuxTarget: 'work:0.0', command: 'claude', agentType: orcs[0]!.agentType });
  });

  it('de-dups repeated ids (single execution per pane, §2.8)', () => {
    const targets = buildTargets(['pane:%1', 'pane:%1', 'pane:%2'], new Set(['pane:%1', 'pane:%2']), map);
    expect(targets.map((t) => t.orcId)).toEqual(['pane:%1', 'pane:%2']);
  });

  it('buildRows exposes paneId + running (never cwd) per D-051 (a)', () => {
    const rows = buildRows(ordered, new Set(['pane:%2']), map);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orcId: 'pane:%2', paneId: '%2', tmuxTarget: 'infra:1.2', running: 'codex' });
    expect(rows[0]).not.toHaveProperty('cwd');
  });
});

describe('bulkSelect (current-camp status class)', () => {
  const orcs = [
    makeOrc({ paneId: '%1', status: 'active' }),
    makeOrc({ paneId: '%2', status: 'waiting' }),
    makeOrc({ paneId: '%3', status: 'waiting' }),
    makeOrc({ paneId: '%4', status: 'idle' }),
  ];
  const ordered = ['pane:%1', 'pane:%2', 'pane:%3', 'pane:%4'];
  const map = byId(orcs);

  it('waiting → only waiting orcs; active → only active', () => {
    expect(bulkSelect(ordered, map, 'waiting')).toEqual(['pane:%2', 'pane:%3']);
    expect(bulkSelect(ordered, map, 'active')).toEqual(['pane:%1']);
  });
});

describe('broadcastSeverity / summarize (SPEC-402 §2.7, AC-18 iii)', () => {
  it('all ok → info, some fail → warn, all fail → error', () => {
    expect(broadcastSeverity(3, 0)).toBe('info');
    expect(broadcastSeverity(2, 1)).toBe('warn');
    expect(broadcastSeverity(0, 3)).toBe('error');
  });

  it('summary line reflects the counts + severity', () => {
    const base: Omit<BroadcastResult, 'successCount' | 'failureCount' | 'targetCount'> = {
      ok: true, campId: 'session:s1', results: [], batchAuditEventId: 'b1', requestId: null,
    };
    expect(summarizeBroadcast({ ...base, targetCount: 3, successCount: 3, failureCount: 0 })).toEqual({
      severity: 'info',
      message: 'Broadcast sent to 3 agents.',
    });
    expect(summarizeBroadcast({ ...base, targetCount: 3, successCount: 2, failureCount: 1 }).severity).toBe('warn');
    expect(summarizeBroadcast({ ...base, targetCount: 3, successCount: 0, failureCount: 3 }).severity).toBe('error');
  });
});

describe('broadcastErrorMessage (request-level, SPEC-402 §2.9)', () => {
  it('maps known codes to user-safe copy', () => {
    expect(broadcastErrorMessage('confirm_required', '')).toMatch(/confirmation required/i);
    expect(broadcastErrorMessage('out_of_camp_scope', '')).toMatch(/outside this camp/i);
    expect(broadcastErrorMessage('too_many_targets', '')).toMatch(/too many targets/i);
    expect(broadcastErrorMessage('weird', 'srv msg')).toBe('srv msg');
  });
});
