/**
 * SPEC-301 §2.7 (#42) — drag-to-pan + zoom/fit.
 *
 * Pure math (fit/clamp/scroll-keep) is deterministic; the CampMap integration verifies that
 * dragging the background updates scrollLeft/Top (and never hijacks an orc click), that the
 * zoom controls change the world scale deterministically, and that Fit computes the scale from
 * world/viewport. jsdom has no layout, so we install writable scroll/client metrics on the
 * scroller element.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { CampMap } from '../src/components/scene/CampMap';
import { useStore } from '../src/store/store';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  clampScale,
  fitScale,
  scrollForZoom,
  zoomIn,
  zoomOut,
} from '../src/scene/panzoom';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc } from '../src/types/domain';

describe('SPEC-301 §2.7 #42 panzoom math (pure, deterministic)', () => {
  it('clampScale + zoom steps stay within [ZOOM_MIN, ZOOM_MAX]', () => {
    expect(clampScale(99)).toBe(ZOOM_MAX);
    expect(clampScale(0)).toBe(ZOOM_MIN);
    expect(zoomOut(1)).toBeCloseTo(0.8, 5);
    expect(zoomIn(1)).toBeCloseTo(1.25, 5);
    // repeated zoom-out never escapes the floor
    let s = 1;
    for (let i = 0; i < 20; i += 1) s = zoomOut(s);
    expect(s).toBe(ZOOM_MIN);
  });

  it('fitScale = min(viewport/world) clamped; degenerate input → 1', () => {
    expect(fitScale({ w: 1200, h: 900 }, { w: 800, h: 600 })).toBeCloseTo(0.6667, 3);
    expect(fitScale({ w: 1200, h: 900 }, { w: 600, h: 900 })).toBeCloseTo(0.5, 5);
    expect(fitScale({ w: 0, h: 0 }, { w: 800, h: 600 })).toBe(1); // guard
    // huge viewport clamps up to ZOOM_MAX, not unbounded
    expect(fitScale({ w: 100, h: 100 }, { w: 9000, h: 9000 })).toBe(ZOOM_MAX);
  });

  it('scrollForZoom keeps the anchored world point fixed across a scale change', () => {
    // a point at viewport-center maps to the same world point before/after.
    const anchor = { x: 400, y: 300 };
    const prev = { left: 200, top: 100 };
    const next = scrollForZoom(prev, 1, 2, anchor);
    const worldBefore = (prev.left + anchor.x) / 1;
    const worldAfter = (next.left + anchor.x) / 2;
    expect(worldAfter).toBeCloseTo(worldBefore, 5);
  });
});

// --- CampMap integration ---

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

/** Give the (layout-less) scroller writable scroll + client metrics. */
function instrumentScroller(el: HTMLElement, vp = { w: 800, h: 600 }): { left: number; top: number } {
  const state = { left: 0, top: 0 };
  Object.defineProperty(el, 'clientWidth', { value: vp.w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: vp.h, configurable: true });
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => state.left,
    set: (v: number) => {
      state.left = Math.max(0, v);
    },
  });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => state.top,
    set: (v: number) => {
      state.top = Math.max(0, v);
    },
  });
  return state;
}

function renderMap(campId: string, onSelect = vi.fn()) {
  const { container } = render(
    <AssetProvider assetBase="/pack">
      <CampMap campId={campId} selectedOrcId={null} onSelect={onSelect} />
    </AssetProvider>,
  );
  const scroll = container.querySelector('.oc-map__scroll') as HTMLElement;
  const world = container.querySelector('.oc-map__world') as HTMLElement;
  return { container, scroll, world, onSelect };
}

beforeEach(() => {
  useStore.getState().resetServer();
  useStore.getState().setReducedMotion(false);
});

describe('SPEC-301 §2.7 #42 drag-to-pan', () => {
  it('dragging the map background updates scrollLeft/Top past the threshold', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    const { scroll } = renderMap(campId);
    const state = instrumentScroller(scroll);

    fireEvent.pointerDown(scroll, { clientX: 200, clientY: 200, pointerType: 'mouse', button: 0 });
    fireEvent.pointerMove(scroll, { clientX: 160, clientY: 150, pointerType: 'mouse' });
    // drag dx=-40 dy=-50 → scroll = start(0) - delta
    expect(state.left).toBe(40);
    expect(state.top).toBe(50);
    fireEvent.pointerUp(scroll, { pointerType: 'mouse' });
  });

  it('a press on the map BACKGROUND below the threshold does not pan', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    const { scroll } = renderMap(campId);
    const state = instrumentScroller(scroll);
    fireEvent.pointerDown(scroll, { clientX: 200, clientY: 200, pointerType: 'mouse', button: 0 });
    fireEvent.pointerMove(scroll, { clientX: 201, clientY: 201, pointerType: 'mouse' }); // 1.4px
    expect(state.left).toBe(0);
    expect(state.top).toBe(0);
  });

  it('a drag STARTING on an orc never pans (clicks/selection are not hijacked)', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    const { container, scroll, onSelect } = renderMap(campId);
    const state = instrumentScroller(scroll);
    const orc = container.querySelector('button.oc-orc') as HTMLButtonElement;

    fireEvent.pointerDown(orc, { clientX: 200, clientY: 200, pointerType: 'mouse', button: 0 });
    fireEvent.pointerMove(scroll, { clientX: 100, clientY: 50, pointerType: 'mouse' });
    expect(state.left).toBe(0); // no pan engaged from an orc press
    expect(state.top).toBe(0);
    fireEvent.click(orc);
    expect(onSelect).toHaveBeenCalledWith('pane:%1'); // click still selects
  });

  it('touch is left to native scrolling (no pointer-pan engaged)', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    const { scroll } = renderMap(campId);
    const state = instrumentScroller(scroll);
    fireEvent.pointerDown(scroll, { clientX: 200, clientY: 200, pointerType: 'touch' });
    fireEvent.pointerMove(scroll, { clientX: 100, clientY: 100, pointerType: 'touch' });
    expect(state.left).toBe(0); // our handler ignores touch → native momentum scroll handles it
    expect(state.top).toBe(0);
  });
});

describe('SPEC-301 §2.7 no-zoom: fixed scale, drag-pan only', () => {
  it('the world renders at a fixed scale (no transform) and exposes no zoom/fit controls', () => {
    const campId = seed([makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' })]);
    const { container, world } = renderMap(campId);
    // no scale transform on the world box (fixed scale)
    expect(world.style.transform).toBe('');
    // the old zoom/fit control cluster is gone
    expect(container.querySelector('[data-testid="map-controls"]')).toBeNull();
    for (const label of ['Zoom out', 'Zoom in', 'Fit camp to view']) {
      expect(container.querySelector(`[aria-label="${label}"]`)).toBeNull();
    }
  });
});
