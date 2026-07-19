/**
 * SPEC-300 §3.8 / D-054 — resolveAssetPackDir precedence and manifest gating.
 *
 * The installed-`orc-camp-assets`-package branch is not exercised here (it needs the package
 * installed); env + explicit-override + no-pack branches cover the resolver's decision logic.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveAssetPackDir } from '../../src/server/asset-pack';

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function makePack(withManifest = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'oc-pack-'));
  tmps.push(dir);
  if (withManifest) writeFileSync(join(dir, 'manifest.json'), '{"id":"test"}');
  return dir;
}

describe('SPEC-300/D-054 — resolveAssetPackDir', () => {
  it('resolves ORC_CAMP_ASSET_PACK when it contains a manifest', () => {
    const dir = makePack();
    const r = resolveAssetPackDir({ ORC_CAMP_ASSET_PACK: dir } as NodeJS.ProcessEnv);
    expect(r).toEqual({ dir: resolve(dir), source: 'env' });
  });

  it('ignores ORC_CAMP_ASSET_PACK without a manifest (falls through)', () => {
    const dir = makePack(false); // dir exists but no manifest.json
    // No installed package in the test env → resolves to null.
    const r = resolveAssetPackDir({ ORC_CAMP_ASSET_PACK: dir } as NodeJS.ProcessEnv);
    expect(r).toBeNull();
  });

  it('explicit override wins and is manifest-gated', () => {
    const dir = makePack();
    expect(resolveAssetPackDir({} as NodeJS.ProcessEnv, dir)).toEqual({ dir: resolve(dir), source: 'env' });
    const empty = makePack(false);
    expect(resolveAssetPackDir({} as NodeJS.ProcessEnv, empty)).toBeNull();
  });

  it('override=null forces "no pack" regardless of env', () => {
    const dir = makePack();
    expect(resolveAssetPackDir({ ORC_CAMP_ASSET_PACK: dir } as NodeJS.ProcessEnv, null)).toBeNull();
  });

  it('returns null when nothing is configured and no package is installed', () => {
    // A clean env (no ORC_CAMP_ASSET_PACK). The test harness has no orc-camp-assets installed.
    expect(resolveAssetPackDir({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
