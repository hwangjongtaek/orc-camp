/**
 * SPEC-300 §2.3 — CampMap assigns characters SEQUENTIALLY (by orc order), not by agent type.
 *
 * End-to-end: render CampMap with a manifest that ships several characters and a camp whose orcs
 * are ALL the same agent type. The rendered sprite image paths must cycle through distinct
 * character roots, proving the character is chosen by the orc's order on the map (the goal), and
 * that two same-agent orcs no longer look identical.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AssetProvider } from '../src/assets/AssetContext';
import { CampMap } from '../src/components/scene/CampMap';
import { useStore } from '../src/store/store';
import { CHARACTER_POOL } from '../src/assets/spriteResolver';
import type { AssetManifest, CharacterDef } from '../src/assets/manifest';
import { makeCamp, makeOrc, makeScan } from './fixtures';
import type { Orc } from '../src/types/domain';

const dirs = ['south', 'east', 'north', 'west', 'south-east', 'north-east', 'north-west', 'south-west'];
const dir8 = (folder: string): Record<string, string> =>
  Object.fromEntries(dirs.map((d) => [d, `${folder}/${d}`]));

function character(root: string): CharacterDef {
  return {
    root,
    frame_size: [232, 232],
    scale: 1,
    anchor: [116, 208],
    directions: dirs,
    animations: {
      idle: { frames: 7, fps: 4, frame_pattern: 'frame_%03d.png', folders: dir8('animations/idle') },
      active: { frames: 7, fps: 8, frame_pattern: 'frame_%03d.png', folders: dir8('animations/active') },
      roaming: { frames: 9, fps: 8, frame_pattern: 'frame_%03d.png', folders: dir8('animations/roaming') },
      waiting: { frames: 7, fps: 4, frame_pattern: 'frame_%03d.png', folders: dir8('animations/waiting') },
    },
    reduced_motion: {
      fallback_state: 'idle',
      fallback_direction: 'south',
      fallback_frame: 'animations/idle/south/frame_000.png',
    },
  };
}

// A manifest shipping the first three pool characters, each with a distinct root.
function multiCharManifest(): AssetManifest {
  return {
    characters: {
      'orc-claude-storm-shaman': character('sprites/orc-claude-storm-shaman/C'),
      'orc-codex-field-engineer': character('sprites/orc-codex-field-engineer/E'),
      'orc-iron-commander': character('sprites/orc-iron-commander/I'),
    },
    objects: {
      'status-ui': { root: 'objects/status-ui', items: { 'waiting-bubble': { file: 'waiting-bubble.png' } } },
    },
  };
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

beforeEach(() => {
  useStore.getState().resetServer();
  useStore.getState().setReducedMotion(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('SPEC-300 §2.3 sequential character assignment (CampMap)', () => {
  it('same-agent orcs cycle through distinct characters in reading order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      ({ ok: true, json: async () => multiCharManifest() }) as unknown as Response,
    ));
    // Four claude-code orcs (same agent type) — sequential assignment must vary the character.
    const campId = seed([
      makeOrc({ paneId: '%1', windowIndex: 0, status: 'waiting', agentType: 'claude-code', tmuxTarget: 'w:0.0' }),
      makeOrc({ paneId: '%2', windowIndex: 0, status: 'waiting', agentType: 'claude-code', tmuxTarget: 'w:0.1' }),
      makeOrc({ paneId: '%3', windowIndex: 0, status: 'waiting', agentType: 'claude-code', tmuxTarget: 'w:0.2' }),
      makeOrc({ paneId: '%4', windowIndex: 0, status: 'waiting', agentType: 'claude-code', tmuxTarget: 'w:0.3' }),
    ]);
    const { container } = render(
      <AssetProvider assetBase="/pack">
        <CampMap campId={campId} selectedOrcId={null} onSelect={() => {}} />
      </AssetProvider>,
    );
    // Wait for the manifest to load and character sprites (not placeholders) to render.
    await waitFor(() =>
      expect(container.querySelectorAll('img.oc-orc__img').length).toBeGreaterThanOrEqual(4),
    );

    const roots = [...container.querySelectorAll('button.oc-orc')].map((btn) => {
      const src = btn.querySelector('img.oc-orc__img')?.getAttribute('src') ?? '';
      const m = src.match(/\/pack\/(sprites\/[^/]+\/[^/]+)\//);
      return m?.[1] ?? src;
    });

    // First three orcs use the first three distinct pool characters; the 4th wraps to the 1st.
    const pool = CHARACTER_POOL.filter((k) => ['orc-claude-storm-shaman', 'orc-codex-field-engineer', 'orc-iron-commander'].includes(k));
    expect(new Set(roots.slice(0, 3)).size).toBe(3); // three different characters
    expect(roots[0]).toContain('orc-claude-storm-shaman'); // pool[0]
    expect(roots[1]).toContain('orc-codex-field-engineer'); // pool[1]
    expect(roots[2]).toContain('orc-iron-commander'); // pool[2]
    expect(roots[3]).toBe(roots[0]); // wrap → pool[0]
    expect(pool.length).toBe(3);
  });
});
