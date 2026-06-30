/**
 * SPEC-304 — OrcInspector (Details tab) portrait slot. Verifies the slot renders for a selected
 * orc with a name/role caption, degrades to a CSS placeholder when no portrait asset is available
 * (manifest unresolved in jsdom), and is absent when no orc is selected (no layout to shift).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AssetProvider } from '../src/assets/AssetContext';
import { ServicesProvider, type AppServices } from '../src/app/services';
import { CampDetailView } from '../src/screens/CampDetailView';
import { useStore } from '../src/store/store';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc } from '../src/types/domain';

const services: AppServices = {
  api: {} as never,
  engine: { refresh: vi.fn() } as never,
};

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

function renderDetail(campId: string, query = ''): HTMLElement {
  const { container } = render(
    <AssetProvider assetBase="/pack">
      <ServicesProvider services={services}>
        <MemoryRouter initialEntries={[`/camps/${campId}${query}`]}>
          <Routes>
            <Route path="/camps/:campId" element={<CampDetailView />} />
          </Routes>
        </MemoryRouter>
      </ServicesProvider>
    </AssetProvider>,
  );
  return container;
}

beforeEach(() => {
  useStore.getState().resetServer();
});

describe('SPEC-304 OrcInspector portrait slot', () => {
  it('AC-17 — no portrait when no orc is selected', () => {
    const campId = seed([makeOrc({ paneId: 'p1' })]);
    const c = renderDetail(campId);
    expect(c.querySelector('[data-testid="orc-portrait"]')).toBeNull();
    expect(c.textContent).toContain('Select an orc to inspect it.');
  });

  it('AC-07 / AC-10 — selected orc shows a placeholder portrait with a name/role caption', () => {
    const campId = seed([makeOrc({ paneId: 'p1', agentType: 'claude-code' })]);
    const c = renderDetail(campId, '?orc=pane:p1');
    const slot = c.querySelector('[data-testid="orc-portrait"]');
    expect(slot).not.toBeNull();
    // manifest is unresolved in jsdom → graceful CSS placeholder, never a broken <img>.
    expect(slot!.querySelector('[data-mode="placeholder"]')).not.toBeNull();
    expect(slot!.querySelector('img')).toBeNull();
    // caption = resolved identity (claude-code → storm shaman).
    expect(within(slot as HTMLElement).getByText('Orc Storm Shaman')).toBeTruthy();
  });

  it('AC-13 — caption reflects the resolved character archetype (codex)', () => {
    const campId = seed([makeOrc({ paneId: 'p1', agentType: 'codex' })]);
    const c = renderDetail(campId, '?orc=pane:p1');
    const slot = c.querySelector('[data-testid="orc-portrait"]') as HTMLElement;
    expect(within(slot).getByText('Orc Field Engineer')).toBeTruthy();
  });
});
