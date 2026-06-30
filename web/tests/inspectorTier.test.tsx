/**
 * SPEC-302 — OrcInspector (Details tab) prestige-tier readout. The Details panel surfaces the
 * orc's earned tier grade (T1..T3 + the character's tier label) with a usage note, and shows
 * "Base" at tier 0 / unmeasured usage. displayedTier is read from the store prestige latch.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { OrcInspector } from '../src/components/inspector/OrcInspector';
import { useStore } from '../src/store/store';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc, OrcUsage } from '../src/types/domain';

function seed(orcs: Orc[]): void {
  useStore.getState().applySnapshot({
    data: makeScan({ camps: [makeCamp({ sessionId: 's1', orcs })] }),
    snapshotVersion: 1,
    runtimeEpoch: 'e1',
    emittedAt: '2026-06-28T00:00:00.000Z',
    recentActivity: [],
  });
}

function renderInspector(orcId: string): HTMLElement {
  const { container } = render(
    <AssetProvider assetBase="/pack">
      <OrcInspector orcId={orcId} />
    </AssetProvider>,
  );
  return container;
}

const usage = (cumulativeTokens: number | null): OrcUsage => ({
  cumulativeTokens,
  cumulativeCostUsd: null,
  source: 'estimated',
  measuredAt: null,
});

beforeEach(() => {
  useStore.getState().resetServer();
});

describe('SPEC-302 OrcInspector prestige tier readout', () => {
  it('tier 0 / unmeasured usage → "Base" + unmeasured note', () => {
    seed([makeOrc({ paneId: 'p1', agentType: 'claude-code' })]);
    const c = renderInspector('pane:p1');
    const tier = c.querySelector('[data-testid="orc-tier"]');
    expect(tier).not.toBeNull();
    expect(tier!.textContent).toContain('Base');
    expect(c.textContent).toContain('usage unmeasured');
    expect(c.querySelector('.oc-tier-badge')).toBeNull(); // no badge at tier 0
  });

  it('latched tier ≥ 1 → T{n} badge + usage token note', () => {
    seed([makeOrc({ paneId: 'p1', agentType: 'claude-code', usage: usage(150_000) })]);
    // 150k tokens → tier 1 under the tuned default thresholds (100k/500k/2M).
    useStore.getState().reconcilePrestige([
      { id: 'pane:p1', characterKey: 'orc-claude-storm-shaman', hasPrestige: true, usage: usage(150_000), uptimeSec: null },
    ]);
    const c = renderInspector('pane:p1');
    const badge = c.querySelector('.oc-tier-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('T1');
    expect(badge!.getAttribute('data-tier')).toBe('1');
    expect(c.textContent).toContain('150k tok'); // basis note behind the grade
  });

  it('AC-14: usage=null + uptime → latched tier badge + uptime basis note (§3.7)', () => {
    // No token/cost correlation, but the agent process has been up 8000s → uptime tier 1.
    seed([makeOrc({ paneId: 'p1', agentType: 'claude-code', usage: null, uptimeSec: 8000 })]);
    useStore.getState().reconcilePrestige([
      { id: 'pane:p1', characterKey: 'orc-claude-storm-shaman', hasPrestige: true, usage: null, uptimeSec: 8000 },
    ]);
    const c = renderInspector('pane:p1');
    const badge = c.querySelector('.oc-tier-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('T1');
    expect(c.textContent).toContain('uptime'); // basis = uptime, not tokens/cost
    expect(c.textContent).toContain('2.2h'); // 8000s → 2.2h
  });

  it('does not show a tier badge when no orc is selected', () => {
    seed([makeOrc({ paneId: 'p1' })]);
    const c = renderInspector('does-not-exist');
    expect(c.querySelector('[data-testid="orc-tier"]')).toBeNull();
    expect(c.textContent).toContain('Select an orc');
  });
});
