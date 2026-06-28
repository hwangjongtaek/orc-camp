/**
 * SPEC-301 §3.3-3 — off-screen static mitigation (P1 perf).
 *
 * Only ON-SCREEN sprites are ticked by the single shared clock; off-screen sprites are
 * skipped from per-tick ref writes (they freeze on a static frame). On re-entering view the
 * sprite immediately catches up to the correct position/phase at the CURRENT shared-clock
 * time (tEnter-anchored, so AC-13 is not broken). Selection/keyboard/a11y/layout untouched.
 *
 * Drives the single shared clock manually (one injected rAF driver) and a mock
 * IntersectionObserver — no per-sprite timers (AC-13a preserved). Ambient wander (§3.1-9) is
 * enabled here purely so an arrived idle orc's renderedPos changes per tick, making the
 * "ticked vs. skipped" distinction observable on the transform.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { RefObject } from 'react';
import { AssetProvider } from '../src/assets/AssetContext';
import { OrcSprite } from '../src/components/sprite/OrcSprite';
import { RoamingController } from '../src/scene/roaming';
import { __setClockDriverForTest } from '../src/scene/clock';

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

class MockIO {
  static last: MockIO | null = null;
  el: Element | null = null;
  options: IntersectionObserverInit | undefined;
  constructor(
    private cb: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.options = options;
    MockIO.last = this;
  }
  observe(el: Element): void {
    this.el = el;
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  set(isIntersecting: boolean): void {
    if (!this.el) return;
    this.cb(
      [{ isIntersecting, target: this.el } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

const ORIG_IO = globalThis.IntersectionObserver;
afterEach(() => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = ORIG_IO;
});

function renderSprite(
  controller: RoamingController,
  scrollRootRef?: RefObject<HTMLElement | null>,
) {
  return render(
    <AssetProvider assetBase="/pack">
      <OrcSprite
        orcId="pane:%1"
        agentType="claude-code"
        status="idle"
        statusConfidence={0.7}
        tmuxTarget="w:0.0"
        currentWorkSummary={null}
        summarySource="unknown"
        summaryIsEstimated={false}
        target={{ x: 100, y: 100 }}
        controller={controller}
        mapSpriteScale={0.9}
        scrollRootRef={scrollRootRef}
        selected={false}
        tabIndex={0}
        onSelect={() => {}}
        onFocusOrc={() => {}}
        onKeyNav={() => false}
        registerButton={() => {}}
      />
    </AssetProvider>,
  );
}

describe('SPEC-301 §3.3-3 off-screen static mitigation', () => {
  it('skips off-screen ticks and resumes the correct state on re-entering view', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIO as unknown as typeof IntersectionObserver;
    const controller = new RoamingController({ ambientWander: true });
    controller.sync(
      [{ id: 'pane:%1', paneId: '%1', status: 'idle', target: { x: 100, y: 100 } }],
      0,
      { reducedMotion: false },
    );
    setupClock();
    const { container } = renderSprite(controller);
    const btn = container.querySelector('button.oc-orc') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(pump).not.toBeNull();
    expect(MockIO.last).not.toBeNull(); // IntersectionObserver was wired

    // On-screen: ticked. Wander makes consecutive frames differ → transform changes.
    act(() => pump!(1000));
    const tf1 = btn.style.transform;
    act(() => pump!(2000));
    const tf2 = btn.style.transform;
    expect(tf2).not.toBe(tf1);

    // Off-screen: subsequent ticks are skipped (transform frozen / static).
    act(() => MockIO.last!.set(false));
    act(() => pump!(3000));
    expect(btn.style.transform).toBe(tf2);
    act(() => pump!(4000));
    expect(btn.style.transform).toBe(tf2);

    // Re-enter view → immediate catch-up to the correct state at the current clock time.
    act(() => MockIO.last!.set(true));
    const tf4 = btn.style.transform;
    expect(tf4).not.toBe(tf2); // resumed (no longer the stale frozen value)

    // Catch-up equals a normal on-screen tick at the same t (correctness / phase resume).
    act(() => pump!(4000));
    expect(btn.style.transform).toBe(tf4);
  });

  it('§2.7 wires the IntersectionObserver root to the scroll viewport when provided', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      MockIO as unknown as typeof IntersectionObserver;
    const controller = new RoamingController({ ambientWander: true });
    controller.sync(
      [{ id: 'pane:%1', paneId: '%1', status: 'idle', target: { x: 100, y: 100 } }],
      0,
      { reducedMotion: false },
    );
    setupClock();
    // The scroll viewport (the .oc-map panel) is the IO root so sprites scrolled out of the
    // WORLD (not just the browser window) are gated (§3.3-3).
    const rootEl = document.createElement('div');
    const scrollRootRef: RefObject<HTMLElement | null> = { current: rootEl };
    renderSprite(controller, scrollRootRef);
    expect(MockIO.last).not.toBeNull();
    expect(MockIO.last!.options?.root).toBe(rootEl);
  });

  it('falls back to always-on-screen when IntersectionObserver is unavailable (jsdom)', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    const controller = new RoamingController({ ambientWander: true });
    controller.sync(
      [{ id: 'pane:%1', paneId: '%1', status: 'idle', target: { x: 100, y: 100 } }],
      0,
      { reducedMotion: false },
    );
    setupClock();
    const { container } = renderSprite(controller);
    const btn = container.querySelector('button.oc-orc') as HTMLButtonElement;
    act(() => pump!(1000));
    const tf1 = btn.style.transform;
    act(() => pump!(2000));
    expect(btn.style.transform).not.toBe(tf1); // ticks run (treated as on-screen)
  });
});
