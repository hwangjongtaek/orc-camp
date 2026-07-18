/**
 * SPEC-700 §2.3 — build → single self-contained installable.
 *
 * Produces one `dist/` tree that `npm i -g orc-camp` ships (package.json#files):
 *
 *   1. bundle CLI + local server (esbuild)        → dist/main.js  (bin entry target)
 *   2. build the dashboard SPA (Vite, in web/)     → web/dist/…
 *   3. copy the built SPA next to the bundle       → dist/dashboard/…
 *
 * The server serves `dist/dashboard/` as static assets (src/server/http.ts), so a
 * globally installed `orc-camp` renders the real dashboard with no extra network
 * fetch (local-first, D-003). The asset pack (asset-packs/) is NOT bundled — the
 * license gate (D-009) keeps it out and the dashboard degrades to the CSS
 * placeholder when the manifest is absent (SPEC-300 §3.8).
 *
 * Run: `npm run build`. Exits non-zero on any step failure.
 */
import { build as esbuild } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const DIST = join(ROOT, 'dist');
const DASHBOARD_OUT = join(DIST, 'dashboard');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function step(msg: string): void {
  console.log(`\n■ ${msg}`);
}

function run(cmd: string, args: string[], cwd = ROOT): void {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`\n✗ ${cmd} ${args.join(' ')} failed (exit ${r.status ?? 'null'})`);
    process.exit(r.status ?? 1);
  }
}

// ── 1. clean ──────────────────────────────────────────────────────────
step('clean dist/');
rmSync(DIST, { recursive: true, force: true });

// ── 2. bundle CLI + server → dist/main.js ────────────────────────────
step('bundle CLI + server (esbuild → dist/main.js)');
await esbuild({
  entryPoints: [join(ROOT, 'src', 'main.ts')],
  bundle: true,
  packages: 'external', // keep `ws` (+ Node builtins) external; installed with the package
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: join(DIST, 'main.js'),
});
console.log('  → dist/main.js');

// ── 3. build the dashboard SPA (Vite, in web/) ───────────────────────
step('build dashboard SPA (web/ — Vite)');
if (!existsSync(join(WEB, 'node_modules'))) {
  console.log('  web/node_modules missing — installing web deps (npm ci)');
  run(NPM, existsSync(join(WEB, 'package-lock.json')) ? ['ci'] : ['install'], WEB);
}
run(NPM, ['run', 'build'], WEB);

// ── 4. copy built SPA → dist/dashboard/ ──────────────────────────────
step('copy dashboard → dist/dashboard/');
const webDist = join(WEB, 'dist');
if (!existsSync(join(webDist, 'index.html'))) {
  console.error(`\n✗ dashboard build produced no index.html at ${webDist}`);
  process.exit(1);
}
cpSync(webDist, DASHBOARD_OUT, { recursive: true });
console.log('  → dist/dashboard/ (served by the local server)');

console.log('\nbuild: OK');
