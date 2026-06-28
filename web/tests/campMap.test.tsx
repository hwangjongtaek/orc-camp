/**
 * SPEC-301 CampMap — keyboard roving-tabindex + selection (AC-09), always-on label/target
 * + on-demand bubble (AC-06), placeholder parity render (AC-10), fixed sprite box (AC-08).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { CampMap } from '../src/components/scene/CampMap';
import { useStore } from '../src/store/store';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc } from '../src/types/domain';

function seed(orcs: Orc[]): string {
  const camp = makeCamp({ sessionId: 's1', orcs });
  const scan = makeScan({ camps: [camp] });
  useStore.getState().applySnapshot({
    data: scan,
    snapshotVersion: 1,
    runtimeEpoch: 'e1',
    emittedAt: '2026-06-28T00:00:00.000Z',
    recentActivity: [],
  });
  return camp.id;
}

function renderMap(campId: string, onSelect = vi.fn()): { container: HTMLElement; onSelect: ReturnType<typeof vi.fn> } {
  const { container } = render(
    <AssetProvider assetBase="/pack">
      <CampMap campId={campId} selectedOrcId={null} onSelect={onSelect} />
    </AssetProvider>,
  );
  return { container, onSelect };
}

const orcButtons = (c: HTMLElement): HTMLButtonElement[] =>
  [...c.querySelectorAll('button.oc-orc')] as HTMLButtonElement[];
const tabbable = (c: HTMLElement): HTMLButtonElement[] => orcButtons(c).filter((b) => b.tabIndex === 0);
const idOf = (b: HTMLButtonElement): string => b.getAttribute('data-orc-id') ?? '';

beforeEach(() => {
  useStore.getState().resetServer();
});

describe('SPEC-301-AC-09 keyboard roving-tabindex + selection', () => {
  it('AC-09: one tab stop per zone; every orc has a reachable button', () => {
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' }),
      makeOrc({ paneId: '%2', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.1' }),
      makeOrc({ paneId: '%3', windowIndex: 1, status: 'idle', tmuxTarget: 'w:1.0' }),
    ]);
    const { container } = renderMap(campId);
    expect(orcButtons(container).length).toBe(3); // no orc is unreachable
    // 2 windows → 2 zones → exactly 2 tab stops
    expect(tabbable(container).length).toBe(2);
  });

  it('AC-09: Arrow moves focus within a zone (both orcs reachable by arrows)', () => {
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' }),
      makeOrc({ paneId: '%2', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.1' }),
    ]);
    const { container } = renderMap(campId);
    const allIds = new Set(orcButtons(container).map(idOf));
    const seen = new Set<string>();
    let active = tabbable(container)[0]!;
    seen.add(idOf(active));
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowDown']) {
      fireEvent.keyDown(active, { key });
      active = tabbable(container)[0]!;
      seen.add(idOf(active));
    }
    expect(tabbable(container).length).toBe(1); // still a single tab stop in the zone
    expect(seen).toEqual(allIds); // arrows reached every orc
  });

  it('AC-09: Enter and Space select the focused orc (→ ?orc); click also selects', () => {
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' }),
    ]);
    const { container, onSelect } = renderMap(campId);
    const btn = orcButtons(container)[0]!;
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('pane:%1');
    fireEvent.keyDown(btn, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(3);
  });
});

describe('SPEC-301-AC-06 always-on status/target + on-demand bubble', () => {
  it('AC-06: status label + raw tmuxTarget are always visible (no hover needed)', () => {
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'waiting', tmuxTarget: 'work:2.5' }),
    ]);
    const { container } = renderMap(campId);
    const btn = within(orcButtons(container)[0]!);
    expect(btn.getByText('Waiting')).toBeTruthy(); // status label
    expect(btn.getByText('work:2.5')).toBeTruthy(); // raw tmuxTarget
  });

  it('AC-06: bubble appears only on focus/hover and never hides the label/target', () => {
    const campId = seed([
      makeOrc({
        paneId: '%1',
        windowIndex: 0,
        status: 'active',
        tmuxTarget: 'work:0.0',
        currentWorkSummary: 'compiling',
        summarySource: 'recent_output',
        summaryIsEstimated: true,
      }),
    ]);
    const { container } = renderMap(campId);
    const btn = orcButtons(container)[0]!;
    expect(container.querySelector('[data-testid="activity-bubble"]')).toBeNull();
    fireEvent.focus(btn);
    const bubble = container.querySelector('[data-testid="activity-bubble"]');
    expect(bubble).not.toBeNull();
    expect(within(bubble as HTMLElement).getByText('compiling')).toBeTruthy();
    // label + target still present alongside the bubble
    expect(within(btn).getByText('Active')).toBeTruthy();
    expect(within(btn).getByText('work:0.0')).toBeTruthy();
    fireEvent.blur(btn);
    expect(container.querySelector('[data-testid="activity-bubble"]')).toBeNull();
  });
});

describe('SPEC-301-AC-10 placeholder parity render', () => {
  it('AC-10: missing assets → CSS station markers + sprite placeholders, interaction intact', () => {
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'active', tmuxTarget: 'w:0.0' }),
    ]);
    const { container } = renderMap(campId);
    // CSS station markers exist for the 7 stations (+ header) with no prop images.
    expect(container.querySelectorAll('.oc-station__marker').length).toBeGreaterThanOrEqual(7);
    // sprite degrades to the CSS pixel placeholder (no manifest in jsdom)
    expect(container.querySelector('.oc-orc__placeholder')).not.toBeNull();
    // status still distinguishable by label (grayscale-safe)
    expect(within(orcButtons(container)[0]!).getByText('Active')).toBeTruthy();
  });
});

describe('SPEC-301-AC-08 fixed sprite box (no layout shift)', () => {
  it('AC-08: orc box = frame_size × mapSpriteScale, absolutely positioned', () => {
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'idle', tmuxTarget: 'w:0.0' }),
    ]);
    const { container } = renderMap(campId);
    const btn = orcButtons(container)[0]!;
    // 232 × 0.9 = 208.8 (placeholder uses the same default frame size → same box; original-size)
    expect(parseFloat(btn.style.width)).toBeCloseTo(208.8, 1);
    expect(parseFloat(btn.style.height)).toBeCloseTo(208.8, 1);
    expect(btn.style.transform).toContain('translate'); // positioned by transform, not flow
  });
});
