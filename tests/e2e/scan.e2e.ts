/**
 * E2E tests (SPEC-007 §2.5 TC-E-*) — the BUILT/real CLI spawned against a LIVE tmux
 * server. NON-GATED (SPEC-007 §3.1-2): excluded from `npm test`; run via
 * `npm run test:e2e`. Skips cleanly when tmux is unavailable.
 *
 * Isolation: creates a uniquely-named throwaway session on the default tmux server,
 * exercises the read-only scan, and always kills the session in afterAll. The scan
 * itself is read-only, so other sessions on the server are never touched; setup/
 * teardown (new-session/kill-session) are the harness's own mutations, not the CLI's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'src', 'cli.ts');
const SESSION = `orccampE2E_${process.pid}_${Date.now()}`;

function tmux(args: string[]) {
  return run('tmux', args, { timeout: 10_000 });
}
function scan(args: string[]) {
  // Spawn the real CLI exactly as a user would (via tsx — same source as the bin).
  return run('npx', ['tsx', CLI, ...args], { cwd: ROOT, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
}
async function tmuxAvailable(): Promise<boolean> {
  try {
    await run('tmux', ['-V'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// top-level await so describe.skipIf can gate on real availability at collection time
const AVAILABLE = await tmuxAvailable();
if (!AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn('[e2e] tmux not available — skipping live e2e suite');
}

interface JsonOrc {
  paneId: string;
  agentType: string;
  statusConfidence: number;
  status: string;
}
interface JsonCamp {
  tmuxSessionName: string;
  orcs: JsonOrc[];
}

describe.skipIf(!AVAILABLE)('e2e: orc-camp scan vs live tmux (TC-E-*)', () => {
  let paneId = '';

  beforeAll(async () => {
    await tmux(['new-session', '-d', '-s', SESSION, '-x', '200', '-y', '50', 'sleep 600']);
    const { stdout } = await tmux(['list-panes', '-t', SESSION, '-F', '#{pane_id}']);
    paneId = stdout.trim().split('\n')[0] ?? '';
    // Tier-B title signature so the static pane is detected as a claude-code orc.
    await tmux(['select-pane', '-t', paneId, '-T', 'claude-code e2e agent']);
  });

  afterAll(async () => {
    try {
      await tmux(['kill-session', '-t', SESSION]);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('TC-E-SMOKE: `scan` exits 0 and prints the tmux header', async () => {
    const { stdout } = await scan([]);
    expect(stdout).toContain('tmux:');
    expect(stdout.toLowerCase()).toContain('server running');
  });

  it('TC-E-SMOKE: `scan --json` is a single valid document (schemaVersion 1)', async () => {
    const { stdout } = await scan(['--json']);
    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(1); // single document, stream-clean
    const r = JSON.parse(lines[0]!);
    expect(r.schemaVersion).toBe(1);
    expect(r.tmux.installed).toBe(true);
    expect(r.tmux.serverRunning).toBe(true);
  });

  it('TC-E-AGENT: the throwaway session is discovered as a camp with a claude-code orc', async () => {
    const { stdout } = await scan(['--json']);
    const r = JSON.parse(stdout.trim()) as { camps: JsonCamp[] };
    const camp = r.camps.find((c) => c.tmuxSessionName === SESSION);
    expect(camp, 'our session should be discovered as a camp').toBeTruthy();
    const orc = camp!.orcs.find((o) => o.paneId === paneId);
    expect(orc, 'the titled pane should be detected as an orc').toBeTruthy();
    expect(orc!.agentType).toBe('claude-code');
    expect(typeof orc!.statusConfidence).toBe('number'); // status always carries confidence
  });

  it('TC-E-READONLY: scanning does not mutate our session pane state', async () => {
    const fmt = '#{pane_id}|#{pane_current_command}|#{pane_title}|#{pane_current_path}';
    const before = (await tmux(['list-panes', '-t', SESSION, '-F', fmt])).stdout;
    await scan([]);
    await scan(['--json']);
    const after = (await tmux(['list-panes', '-t', SESSION, '-F', fmt])).stdout;
    expect(after).toBe(before);
  });

  it('TC-E-LATENCY(sanity): scanDurationMs is reported and bounded', async () => {
    const { stdout } = await scan(['--json']);
    const r = JSON.parse(stdout.trim()) as { diagnostics: { scanDurationMs: number } };
    expect(r.diagnostics.scanDurationMs).toBeGreaterThanOrEqual(0);
    expect(r.diagnostics.scanDurationMs).toBeLessThan(10_000); // generous; formal p95<1s is M4
  });
});
