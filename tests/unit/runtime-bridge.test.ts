/**
 * SPEC-104 §2.7 / D-052 — the control-mode bridge opt-in gate.
 *
 * `SnapshotRuntime.liveBridgeEnabled()` returns true iff a spawner is wired AND the
 * bridge is opted in via EITHER the live settings key (`liveViewBridge`) OR the deps
 * test-override flag. Settings are live-read, so a mid-run toggle flips the gate for
 * the next attach without any restart.
 */
import { describe, expect, it } from 'vitest';
import { SnapshotRuntime } from '../../src/server/runtime';
import { SettingsStore } from '../../src/server/settings';
import type { SpawnBridgeFn } from '../../src/server/bridge';
import { makeDeps } from '../helpers/fixture';

const noopSpawner = (() => ({ dispose() {} })) as unknown as SpawnBridgeFn;

function makeRuntime(o: { settingsBridge?: boolean; depsBridge?: boolean; spawner?: boolean }): {
  runtime: SnapshotRuntime;
  settings: SettingsStore;
} {
  const { deps } = makeDeps({ sessions: [], panes: [] });
  const settings = SettingsStore.inMemory({ scanIntervalS: 3, preview: { exposureEnabled: false, lineCount: 12 }, liveViewBridge: o.settingsBridge });
  const runtime = new SnapshotRuntime({
    deps: { ...deps, spawnBridge: o.spawner ? noopSpawner : undefined, liveViewBridge: o.depsBridge },
    settings,
    runtimeEpoch: 'e',
    now: () => new Date('2026-07-07T00:00:00.000Z'),
  });
  return { runtime, settings };
}

describe('SnapshotRuntime.liveBridgeEnabled — gate truth table (SPEC-104 §2.7 / D-052)', () => {
  // spawnBridge present: gate = settings OR deps override
  it('spawner + settings on → enabled', () => {
    expect(makeRuntime({ spawner: true, settingsBridge: true }).runtime.liveBridgeEnabled()).toBe(true);
  });
  it('spawner + deps override on (settings off) → enabled', () => {
    expect(makeRuntime({ spawner: true, settingsBridge: false, depsBridge: true }).runtime.liveBridgeEnabled()).toBe(true);
  });
  it('spawner + both on → enabled', () => {
    expect(makeRuntime({ spawner: true, settingsBridge: true, depsBridge: true }).runtime.liveBridgeEnabled()).toBe(true);
  });
  it('spawner + both off → disabled', () => {
    expect(makeRuntime({ spawner: true, settingsBridge: false, depsBridge: false }).runtime.liveBridgeEnabled()).toBe(false);
  });

  // spawnBridge absent: never enabled regardless of opt-in
  it('no spawner + settings on → disabled (spawner required)', () => {
    expect(makeRuntime({ spawner: false, settingsBridge: true, depsBridge: true }).runtime.liveBridgeEnabled()).toBe(false);
  });
});

describe('liveBridgeEnabled — settings live-flip (SPEC-104 §2.7 / SPEC-500 §2.7)', () => {
  it('flipping the settings key on/off changes the gate without restart', () => {
    const { runtime, settings } = makeRuntime({ spawner: true, settingsBridge: false });
    expect(runtime.liveBridgeEnabled()).toBe(false); // starts off (polling)

    expect(settings.patch({ liveViewBridge: true }).ok).toBe(true);
    expect(runtime.liveBridgeEnabled()).toBe(true); // next attach would spawn the bridge

    expect(settings.patch({ liveViewBridge: false }).ok).toBe(true);
    expect(runtime.liveBridgeEnabled()).toBe(false); // next attach falls back to polling
  });
});
