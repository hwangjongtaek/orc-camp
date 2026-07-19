/**
 * SPEC-300 §3.8 / D-054 — resolve the OPTIONAL pixel-art asset pack the local server
 * serves at `/asset-pack/*`.
 *
 * The pack is NOT bundled in the core `orc-camp` package (it is a separate, optional
 * `orc-camp-assets` package, ~large). When present the dashboard renders real sprites;
 * when absent it falls back to CSS placeholders (SPEC-300 §3.8 parity — never an error).
 *
 * Resolution order (first hit wins):
 *   1. `ORC_CAMP_ASSET_PACK` env — an explicit pack directory (dev / repo / custom pack).
 *   2. the installed `orc-camp-assets` package — resolved as a sibling of the core package
 *      (works for `npm i -g orc-camp-assets` alongside a global `orc-camp`).
 *   3. null → no pack → placeholder rendering.
 *
 * A directory qualifies only if it contains `manifest.json`.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export type AssetPackSource = 'env' | 'package';

export interface ResolvedAssetPack {
  dir: string;
  source: AssetPackSource;
}

function hasManifest(dir: string): boolean {
  try {
    return existsSync(resolve(dir, 'manifest.json'));
  } catch {
    return false;
  }
}

/** The installed `orc-camp-assets` package dir, or null when it is not installed. */
function resolveInstalledPack(): string | null {
  try {
    const require = createRequire(import.meta.url);
    // Resolve the manifest entry so we get the package root even without a "main"/"exports".
    return dirname(require.resolve('orc-camp-assets/manifest.json'));
  } catch {
    return null;
  }
}

/**
 * Resolve the asset pack directory (or null). `override` short-circuits resolution and is
 * used by tests / by `serve` when a directory is passed explicitly; `null` forces "no pack".
 */
export function resolveAssetPackDir(
  env: NodeJS.ProcessEnv = process.env,
  override?: string | null,
): ResolvedAssetPack | null {
  if (override !== undefined) {
    return override !== null && hasManifest(override) ? { dir: resolve(override), source: 'env' } : null;
  }
  const envDir = env.ORC_CAMP_ASSET_PACK;
  if (envDir && hasManifest(envDir)) return { dir: resolve(envDir), source: 'env' };
  const pkgDir = resolveInstalledPack();
  if (pkgDir && hasManifest(pkgDir)) return { dir: pkgDir, source: 'package' };
  return null;
}
