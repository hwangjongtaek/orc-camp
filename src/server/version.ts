/**
 * Single source of truth for the app version (SPEC-700 AC-17 — tag == published version).
 *
 * Read once from the nearest `package.json` walking up from this module's location. This works
 * in dev (`src/server/version.ts` → repo `package.json`) and in the esbuild bundle
 * (`dist/main.js` → the installed package's `package.json`, which npm always ships), so the
 * three surfaces that report a version (`--version`, `doctor`, `serve`) never drift from
 * `package.json#version`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function readVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = join(dir, 'package.json');
    if (existsSync(p)) {
      try {
        const v = (JSON.parse(readFileSync(p, 'utf8')) as { version?: unknown }).version;
        if (typeof v === 'string' && v.length > 0) return v;
      } catch {
        /* keep walking up */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

export const APP_VERSION: string = readVersion();
