/**
 * SPEC-700 §2.5 / §2.7 — packaged-CLI smoke (release gate).
 *
 * Builds the bundle, then exercises the *built* artifact the way a globally
 * installed user would, plus a tarball file-set gate that enforces the license
 * gate (D-009) and the `files` allowlist (SPEC-700 §2.2):
 *
 *   1. `npm run build`                         — fresh dist
 *   2. `npm pack --dry-run --json`             — assert tarball file-set
 *        · license gate (G1): no asset-pack paths / no *.png / *.zip
 *        · artifact allowlist: no src/ tests/ docs/ .env .mcp.json node_modules/
 *        · required: dist/main.js + bin/orc-camp.mjs present
 *   3. `orc-camp --version`                    — exit 0, semver
 *   4. `orc-camp doctor --json`                — valid {checks,summary,ok,diagnostics}
 *   5. `orc-camp scan --json | parse`          — soft-pass (skip) if tmux absent
 *
 * Run: `npm run smoke`. Exits non-zero on any hard failure (soft-passes do not fail).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'orc-camp.mjs');
const NODE = process.execPath;
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let failures = 0;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => {
  failures += 1;
  console.error(`  ✗ ${m}`);
};
const skip = (m: string) => console.log(`  → SKIP ${m}`);
const section = (t: string) => console.log(`\n■ ${t}`);

function run(cmd: string, args: string[], inherit = false): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });
}

// ── 1. build ─────────────────────────────────────────────────────────
section('build (npm run build)');
const build = run(NPM, ['run', 'build'], true);
if (build.status === 0) pass('build succeeded');
else fail(`build exited ${build.status}`);

// ── 2. tarball file-set gate (license + allowlist) ───────────────────
section('npm pack --dry-run (file-set gate)');
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /^asset-packs\//i, why: 'asset pack (license gate D-009)' },
  { re: /\.png$/i, why: 'PNG asset (license gate D-009)' },
  { re: /\.zip$/i, why: 'asset archive (license gate D-009)' },
  { re: /(^|\/)\.env(\.|$)/i, why: 'secret env file' },
  { re: /\.pem$/i, why: 'key material' },
  { re: /^src\//i, why: 'source (not shipped)' },
  { re: /^tests\//i, why: 'tests (not shipped)' },
  { re: /^docs\//i, why: 'docs (not shipped)' },
  { re: /^scripts\//i, why: 'scripts (not shipped)' },
  { re: /^node_modules\//i, why: 'node_modules' },
  { re: /(^|\/)\.mcp\.json$/i, why: 'mcp config' },
  { re: /(^|\/)generation\//i, why: 'asset generation metadata' },
];
const REQUIRED = ['dist/main.js', 'bin/orc-camp.mjs'];

const packed = run(NPM, ['pack', '--dry-run', '--json']);
if (packed.status !== 0) {
  fail(`npm pack --dry-run exited ${packed.status}: ${packed.stderr?.trim()}`);
} else {
  let files: string[] = [];
  try {
    const parsed = JSON.parse(packed.stdout) as { files: { path: string }[] }[];
    files = (parsed[0]?.files ?? []).map((f) => f.path.replace(/\\/g, '/'));
  } catch (e) {
    fail(`could not parse npm pack JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`  tarball file-set (${files.length}): ${files.join(', ')}`);
  const violations: string[] = [];
  for (const f of files) {
    for (const { re, why } of FORBIDDEN) {
      if (re.test(f)) violations.push(`${f} → ${why}`);
    }
  }
  if (violations.length === 0) pass('no forbidden paths in tarball (asset pack / secrets / source excluded)');
  else for (const v of violations) fail(`forbidden in tarball: ${v}`);

  for (const req of REQUIRED) {
    if (files.includes(req)) pass(`tarball contains ${req}`);
    else fail(`tarball missing required ${req}`);
  }
}

// ── 3. orc-camp --version ────────────────────────────────────────────
section('orc-camp --version');
const ver = run(NODE, [BIN, '--version']);
if (ver.status === 0 && /^\d+\.\d+\.\d+/.test(ver.stdout.trim())) pass(`--version → ${ver.stdout.trim()} (exit 0)`);
else fail(`--version exit=${ver.status} stdout=${JSON.stringify(ver.stdout)}`);

// ── 4. orc-camp doctor --json ────────────────────────────────────────
section('orc-camp doctor --json');
const doc = run(NODE, [BIN, 'doctor', '--json']);
// doctor exits 1 when an environment check fails (e.g. no tmux). Either 0 or 1 is a
// valid run; we assert the JSON contract, not the health verdict.
if (doc.status === 0 || doc.status === 1) {
  try {
    const j = JSON.parse(doc.stdout) as {
      checks?: unknown[];
      summary?: { pass: number; warn: number; fail: number };
      ok?: boolean;
      diagnostics?: { environment?: Record<string, unknown>; installHealth?: Record<string, unknown> };
    };
    const okShape =
      Array.isArray(j.checks) &&
      typeof j.ok === 'boolean' &&
      j.summary != null &&
      typeof j.summary.fail === 'number' &&
      j.diagnostics?.environment != null &&
      j.diagnostics?.installHealth != null;
    if (okShape) pass(`doctor --json ok-structure valid (ok=${j.ok}, exit ${doc.status})`);
    else fail(`doctor --json missing expected keys: ${doc.stdout.slice(0, 200)}`);
  } catch (e) {
    fail(`doctor --json not parseable: ${e instanceof Error ? e.message : String(e)}`);
  }
} else {
  fail(`doctor exited unexpectedly (${doc.status}): ${doc.stderr?.trim()}`);
}

// ── 5. orc-camp scan --json (soft-pass if tmux absent) ───────────────
section('orc-camp scan --json');
const tmuxProbe = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
const tmuxPresent = tmuxProbe.error == null && tmuxProbe.status === 0;
if (!tmuxPresent) {
  skip('tmux not installed — scan smoke soft-passed (SPEC-700 §2.5 non-gate)');
} else {
  const scan = run(NODE, [BIN, 'scan', '--json']);
  if (scan.status === 0) {
    try {
      const s = JSON.parse(scan.stdout) as { schemaVersion?: number; camps?: unknown[]; tmux?: unknown };
      if (typeof s.schemaVersion === 'number' && Array.isArray(s.camps) && s.tmux != null) {
        pass(`scan --json parsed (schemaVersion=${s.schemaVersion}, camps=${s.camps.length})`);
      } else {
        fail(`scan --json missing expected keys: ${scan.stdout.slice(0, 200)}`);
      }
    } catch (e) {
      fail(`scan --json not parseable: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    fail(`scan exit=${scan.status}: ${scan.stderr?.trim()}`);
  }
}

// ── verdict ──────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log('smoke: PASS');
  process.exit(0);
} else {
  console.error(`smoke: FAIL (${failures} failure${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
