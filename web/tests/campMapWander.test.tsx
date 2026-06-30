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

  // §3.1-10 — active orcs no longer stand still: they run a continuous roam ↔ active patrol.
  it('§3.1-10 active orcs patrol (roam ↔ active) — position + movement change over time', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' })]);
    setupClock();
    const container = renderMap(campId);
    const btn = container.querySelector('button.oc-orc') as HTMLButtonElement;
    const positions = new Set<string>();
    const movements = new Set<string>();
    for (const t of [500, 1500, 2500, 3500, 4500, 5500, 6500, 7500]) {
      act(() => pump!(t));
      positions.add(btn.style.transform);
      movements.add(btn.getAttribute('data-movement') ?? '');
    }
    expect(positions.size).toBeGreaterThan(1); // the orc moved along its patrol path
    expect(movements.has('roaming')).toBe(true); // it walks (roaming leg) during the loop
    expect(movements.has('arrived')).toBe(true); // and dwells (active anim) between legs
  });

  // §3.1-10 — a non-active orc settles at a fixed seeded rest spot (animated in place, no drift).
  it('§3.1-10 non-active (waiting) orcs rest at a stable seeded position', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'waiting', tmuxTarget: 'w:0.0' })]);
    setupClock();
    const container = renderMap(campId);
    const btn = container.querySelector('button.oc-orc') as HTMLButtonElement;
    act(() => pump!(1000));
    const tf1 = btn.style.transform;
    act(() => pump!(5000));
    expect(btn.style.transform).toBe(tf1); // waiting orc holds its rest spot (only idle wanders)
    expect(btn.getAttribute('data-movement')).toBe('arrived');
  });
});

describe('SPEC-301 §2.4b #51 personal-space bubble (no overlap)', () => {
  const xyOf = (btn: HTMLElement): { x: number; y: number } => {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(btn.style.transform);
    return { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) };
  };

  it('orcs in the same zone get spaced, distinct positions (grid cells)', () => {
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' }),
      makeOrc({ paneId: '%2', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.1' }),
      makeOrc({ paneId: '%3', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.2' }),
      makeOrc({ paneId: '%4', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.3' }),
    ]);
    setupClock();
    const container = renderMap(campId);
    act(() => pump!(1000));
    const pts = [...container.querySelectorAll('button.oc-orc')].map((b) => xyOf(b as HTMLElement));
    // every pair of orcs is kept a real distance apart (their personal-space cells don't overlap).
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y);
        expect(d).toBeGreaterThan(200);
      }
    }
  });
});

describe('SPEC-301 §2.6b #50 intermittent ambient speech bubble', () => {
  const has = (c: HTMLElement): boolean => c.querySelector('[data-testid="speech-bubble"]') !== null;

  it('orcs occasionally pop a speech bubble (present at some times, absent at others)', () => {
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0', currentWorkSummary: 'compiling the parser module' }),
    ]);
    setupClock();
    const container = renderMap(campId);
    let sawSpeaking = false;
    let sawSilent = false;
    for (let t = 0; t <= 60000; t += 1000) {
      act(() => pump!(t));
      if (has(container)) sawSpeaking = true;
      else sawSilent = true;
    }
    expect(sawSpeaking).toBe(true); // it speaks at some point
    expect(sawSilent).toBe(true); // …and is silent at others (intermittent)
  });

  it('reduced-motion disables the auto speech bubble (no autoplay)', () => {
    useStore.getState().setReducedMotion(true);
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0', currentWorkSummary: 'compiling the parser module' }),
    ]);
    setupClock();
    const container = renderMap(campId);
    let everSpoke = false;
    for (let t = 0; t <= 60000; t += 1000) {
      act(() => pump!(t));
      if (has(container)) everSpoke = true;
    }
    expect(everSpoke).toBe(false); // silent under reduced-motion
  });
});
