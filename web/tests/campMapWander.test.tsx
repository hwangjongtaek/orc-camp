/**
 * SPEC-301 §3.1-9 (#43) — ambient micro-wander is ON by default in CampMap.
 *
 * Verifies the CampMap-level wiring (the controller-level gate/determinism is covered by
 * wander.test.ts): an idle camp gently drifts by default, reduced-motion disables it, and the
 * logical movement state stays 'arrived' (target/slot unchanged — pure renderedPos jitter).
 * Drives the single shared clock with one injected rAF driver (no per-sprite timers).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { CampMap } from '../src/components/scene/CampMap';
import { useStore } from '../src/store/store';
import { __setClockDriverForTest } from '../src/scene/clock';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc } from '../src/types/domain';

let pump: ((t: number) => void) | null = null;
function setupClock(): void {
  pump = null;
  __setClockDriverForTest({
    raf: (cb) => {
      pump = cb;
      return 1;
    },
    caf: () => {},
  });
}

function seed(orcs: Orc[]): string {
  const camp = makeCamp({ sessionId: 's1', orcs });
  useStore.getState().applySnapshot({
    data: makeScan({ camps: [camp] }),
    snapshotVersion: 1,
    runtimeEpoch: 'e1',
    emittedAt: '2026-06-28T00:00:00.000Z',
    recentActivity: [],
  });
  return camp.id;
}

function renderMap(campId: string): HTMLElement {
  const { container } = render(
    <AssetProvider assetBase="/pack">
      <CampMap campId={campId} selectedOrcId={null} onSelect={() => {}} />
    </AssetProvider>,
  );
  return container;
}

beforeEach(() => {
  useStore.getState().resetServer();
  useStore.getState().setReducedMotion(false);
});

describe('SPEC-301 §3.1-9 #43 ambient wander ON by default in CampMap', () => {
  it('an arrived idle orc gently drifts over time (enabled by default)', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    setupClock();
    const container = renderMap(campId);
    const btn = container.querySelector('button.oc-orc') as HTMLButtonElement;

    act(() => pump!(1000));
    const tf1 = btn.style.transform;
    act(() => pump!(5000));
    const tf2 = btn.style.transform;
    expect(tf1).not.toBe(tf2); // wander is ON → renderedPos drifts
    // …but the LOGICAL movement state never leaves 'arrived' (target/slot untouched).
    expect(btn.getAttribute('data-movement')).toBe('arrived');
  });

  it('reduced-motion disables the wander (transform is stable)', () => {
    useStore.getState().setReducedMotion(true);
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    setupClock();
    const container = renderMap(campId);
    const btn = container.querySelector('button.oc-orc') as HTMLButtonElement;

    act(() => pump!(1000));
    const tf1 = btn.style.transform;
    act(() => pump!(5000));
    expect(btn.style.transform).toBe(tf1); // reduced-motion → no wander
  });

  it('non-idle arrived orcs do not wander', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' })]);
    setupClock();
    const container = renderMap(campId);
    const btn = container.querySelector('button.oc-orc') as HTMLButtonElement;
    act(() => pump!(1000));
    const tf1 = btn.style.transform;
    act(() => pump!(5000));
    expect(btn.style.transform).toBe(tf1); // only idle wanders (§3.1-9)
  });
});
