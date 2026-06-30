/**
 * Integration tests (TC-I-*) — full CLI/runner pipeline driven by a fixture-backed
 * fake spawn (the REAL tmuxExec allowlist + introspect + redaction + detection +
 * status + assembly + render all run). No live tmux; deterministic clock.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { run, parseArgs } from '../../src/cli';
import { ScanRunner } from '../../src/scan';
import { READONLY_ALLOWLIST, type ScanResult } from '../../src/types';
import { makeDeps, makeIO, type Scenario } from '../helpers/fixture';

const WORK_SESSION = { sessionId: '$1', sessionName: 'work', windows: 1 };
const CLAUDE_PANE = {
  sessionName: 'work',
  windowIndex: 1,
  paneIndex: 0,
  paneId: '%10',
  command: 'claude',
  cwd: '/Users/me/proj',
  pid: 1001,
  active: true,
};
const SHELL_PANE = {
  sessionName: 'work',
  windowIndex: 1,
  paneIndex: 1,
  paneId: '%11',
  command: 'zsh',
  pid: 1002,
};

function normalScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    sessions: [WORK_SESSION],
    panes: [CLAUDE_PANE, SHELL_PANE],
    captures: { '%10': 'Editing src/server.ts', '%11': '$ ' },
    ps: { '1001': 'node /opt/claude/cli.js', '1002': '-zsh' }, // live pids → processAlive=true
    ...overrides,
  };
}

async function runJson(scenario: Scenario): Promise<{ code: number; result: ScanResult; out: string; err: string }> {
  const { deps } = makeDeps(scenario);
  const cap = makeIO();
  const code = await run(['--json'], { io: cap.io, deps });
  const out = cap.stdout();
  return { code, result: JSON.parse(out.trim()) as ScanResult, out, err: cap.stderr() };
}

describe('TC-I-SCAN-NORMAL (SPEC-001-AC-01, SPEC-002-AC-01, SPEC-005-AC-02/03)', () => {
  it('renders a table with the orc and a sane header/legend', async () => {
    const { deps } = makeDeps(normalScenario());
    const cap = makeIO();
    const code = await run([], { io: cap.io, deps });
    const out = cap.stdout();
    expect(code).toBe(0);
    expect(out).toContain('CAMP work');
    expect(out).toContain('work:1.0 %10'); // TARGET = tmuxTarget + paneId (R-UI-007)
    expect(out).toContain('claude-code');
    expect(out).toMatch(/legend:/);
    // every orc row shows status WITH its confidence (SPEC-001-AC-11, never status-as-fact)
    expect(out).toMatch(/(active|waiting|idle|stale|error|unknown|terminated) \d\.\d\d/);
  });

  it('--json is a single valid document with the SPEC-005 envelope + orc fields', async () => {
    const { code, result, out } = await runJson(normalScenario());
    expect(code).toBe(0);
    expect(result.schemaVersion).toBe(1);
    expect(result.tmux).toEqual({ installed: true, serverRunning: true, version: '3.6b' });
    expect(result.stale).toBe(false);
    expect(result.lastGoodAt).toBe(result.scannedAt); // fresh ⇒ equal (SPEC-005 §3.1-2)
    expect(result.camps).toHaveLength(1);
    const camp = result.camps[0]!;
    expect(camp.id).toBe('session:$1');
    expect(camp.orcCount).toBe(1);
    expect(camp.paneCount).toBe(2); // non-candidate shell counted (paneCount > orcCount)
    const orc = camp.orcs[0]!;
    expect(orc.id).toBe('pane:%10');
    expect(orc.id).toMatch(/^pane:%[0-9]+$/);
    expect(orc.agentType).toBe('claude-code');
    expect(orc.agentTypeConfidence).toBeGreaterThanOrEqual(0.85);
    expect(orc.agentSignals.length).toBeGreaterThanOrEqual(1);
    expect(typeof orc.statusConfidence).toBe('number');
    expect(typeof orc.summaryIsEstimated).toBe('boolean');
    // stdout must be ONE line of JSON (NDJSON-safe), nothing else
    expect(out.trim().split('\n')).toHaveLength(1);
  });

  it('agent uptime (SPEC-302 §3.7) flows from the ps `etimes` column through to the serialized orc', async () => {
    // Full pipeline: psSnapshotArgs(etimes) → parsePsSnapshot → buildSubtree → inventory → assemble.
    const { result } = await runJson(
      normalScenario({
        ps: undefined,
        processTable: [
          { pid: 1001, ppid: 1, command: 'claude', etimeSec: 5400 }, // pane_pid of %10 (claude orc)
          { pid: 1002, ppid: 1, command: '-zsh', etimeSec: 9000 }, // shell pane (non-orc)
        ],
      }),
    );
    const orc = result.camps[0]!.orcs[0]!;
    expect(orc.paneId).toBe('%10');
    expect(orc.uptimeSec).toBe(5400);
  });
});

describe('TC-I-JSON-HYGIENE (SPEC-001-AC-02/04)', () => {
  it('stdout is pure JSON; diagnostics/progress never leak to stdout', async () => {
    const { deps } = makeDeps(normalScenario({ captureFail: ['%11'] }));
    const cap = makeIO();
    await run(['--json'], { io: cap.io, deps });
    expect(() => JSON.parse(cap.stdout().trim())).not.toThrow();
  });
});

describe('TC-I-EMPTY (SPEC-001-AC-03/13, SPEC-002-AC-08/09/10, SPEC-005-AC-05/06)', () => {
  it('not_installed → exit 0, installed=false, distinct message', async () => {
    const { code, result } = await runJson({ installed: false });
    expect(code).toBe(0);
    expect(result.tmux.installed).toBe(false);
    expect(result.tmux.serverRunning).toBe(false);
    expect(result.camps).toHaveLength(0);
    const { deps } = makeDeps({ installed: false });
    const cap = makeIO();
    await run([], { io: cap.io, deps });
    expect(cap.stdout().toLowerCase()).toContain('not installed');
  });

  it('server_not_running → installed=true, serverRunning=false', async () => {
    const { result } = await runJson({ serverState: 'no-server' });
    expect(result.tmux.installed).toBe(true);
    expect(result.tmux.serverRunning).toBe(false);
    expect(result.camps).toHaveLength(0);
    const { deps } = makeDeps({ serverState: 'no-server' });
    const cap = makeIO();
    await run([], { io: cap.io, deps });
    expect(cap.stdout().toLowerCase()).toContain('no server');
  });

  it('running_no_session → serverRunning=true, camps=[]', async () => {
    const { result } = await runJson({ serverState: 'no-session' });
    expect(result.tmux.serverRunning).toBe(true);
    expect(result.camps).toHaveLength(0);
    const { deps } = makeDeps({ serverState: 'no-session' });
    const cap = makeIO();
    await run([], { io: cap.io, deps });
    expect(cap.stdout().toLowerCase()).toContain('no sessions');
  });

  it('no-agent → camps non-empty, all orcCount=0, distinct message', async () => {
    const scenario: Scenario = {
      sessions: [WORK_SESSION],
      panes: [SHELL_PANE],
      captures: { '%11': '$ ' },
    };
    const { result } = await runJson(scenario);
    expect(result.camps).toHaveLength(1);
    expect(result.camps[0]!.orcCount).toBe(0);
    const { deps } = makeDeps(scenario);
    const cap = makeIO();
    await run([], { io: cap.io, deps });
    expect(cap.stdout().toLowerCase()).toContain('no agents detected');
  });
});

describe('TC-I-CAPFAIL (SPEC-001-AC-05, SPEC-002-AC-05, SPEC-005-AC-10)', () => {
  it('a capture failure is isolated → preview null, exit 0, diagnostics recorded', async () => {
    const { code, result } = await runJson(normalScenario({ captureFail: ['%10'] }));
    expect(code).toBe(0);
    const orc = result.camps[0]!.orcs[0]!;
    expect(orc.preview).toBeNull();
    const capErr = result.diagnostics.tmuxErrors.find((e) => e.phase === 'capture');
    expect(capErr?.target).toBe('%10');
  });
});

describe('TC-I-READONLY (SPEC-002-AC-13, SPEC-006-AC-12b)', () => {
  it('every spawned tmux subcommand is read-only; ps uses fixed argv', async () => {
    const { deps, log } = makeDeps(normalScenario({ ps: { '1001': 'node /x/claude' } }));
    const cap = makeIO();
    await run([], { io: cap.io, deps });
    const tmuxCalls = log.filter((e) => e.file === 'tmux');
    expect(tmuxCalls.length).toBeGreaterThan(0);
    for (const call of tmuxCalls) {
      const sub = call.args[0]!;
      expect(sub === '-V' || READONLY_ALLOWLIST.has(sub)).toBe(true);
    }
    // SPEC-002 §2.9: a single read-only process-table snapshot (no per-pid `ps -p`, no
    // state-changing flags). One ps spawn for the whole scan (O(1)); platform-robust argv.
    const psCalls = log.filter((e) => e.file === 'ps');
    expect(psCalls.length).toBe(1);
    const READONLY_PS_ARGV = [
      ['-axo', 'pid=,ppid=,etime=,command='], // darwin/bsd (etime, formatted)
      ['-eo', 'pid=,ppid=,etimes=,args='], // linux (etimes, seconds)
    ];
    for (const call of psCalls) {
      expect(READONLY_PS_ARGV.some((v) => JSON.stringify(v) === JSON.stringify(call.args))).toBe(true);
    }
  });
});

describe('TC-I-SECRET-ALLPATHS (SPEC-006-AC-01, SPEC-001-AC-12)', () => {
  const SECRET = 'ghp_AAAAAAAAAAAAAAAAAAAA1234';
  it('a planted secret in capture appears in no output path', async () => {
    const scenario = normalScenario({ captures: { '%10': `pushing with ${SECRET}\n`, '%11': '$ ' } });
    const { out } = await runJson(scenario);
    expect(out).not.toContain(SECRET);
    const { deps } = makeDeps(scenario);
    const cap = makeIO();
    await run([], { io: cap.io, deps });
    expect(cap.stdout()).not.toContain(SECRET);
    expect(cap.stderr()).not.toContain(SECRET); // diagnostics/log path too (SPEC-006-AC-11)
  });
});

describe('TC-I-NONPERSIST (SPEC-006-AC-10, R-PRIV-004) — capture text never hits the filesystem', () => {
  it('a scan with a planted secret performs no capture-bearing file writes', async () => {
    const SECRET = 'ghp_CCCCCCCCCCCCCCCCCCCC0000';
    const writes: string[] = [];
    const record = (data: unknown): void => {
      writes.push(typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : String(data));
    };
    const spies = [
      vi.spyOn(fs, 'writeFileSync').mockImplementation(((_p: unknown, d: unknown) => record(d)) as typeof fs.writeFileSync),
      vi.spyOn(fs, 'appendFileSync').mockImplementation(((_p: unknown, d: unknown) => record(d)) as typeof fs.appendFileSync),
      vi.spyOn(fsp, 'writeFile').mockImplementation((async (_p: unknown, d: unknown) => record(d)) as typeof fsp.writeFile),
      vi.spyOn(fsp, 'appendFile').mockImplementation((async (_p: unknown, d: unknown) => record(d)) as typeof fsp.appendFile),
    ];
    try {
      const { deps } = makeDeps(normalScenario({ captures: { '%10': `pushing ${SECRET}`, '%11': '$ ' } }));
      const cap = makeIO();
      await run(['--json'], { io: cap.io, deps });
      expect(cap.stdout()).not.toContain(SECRET);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    // scan is stdout-only: no file write at all, and certainly none carrying the secret.
    expect(writes.some((w) => w.includes(SECRET))).toBe(false);
    expect(writes).toHaveLength(0);
  });
});

describe('TC-I-NOURL (SPEC-001-AC-14)', () => {
  it('scan emits no dashboard URL / never references a listening port', async () => {
    const { out } = await runJson(normalScenario());
    expect(out).not.toMatch(/https?:\/\//);
    expect(out.toLowerCase()).not.toContain('listening');
  });
});

describe('estimated marker + determinism (SPEC-001-AC-10, SPEC-005-AC-13)', () => {
  it('estimated summary renders with the ~ marker', async () => {
    const { deps } = makeDeps(normalScenario());
    const cap = makeIO();
    await run([], { io: cap.io, deps });
    expect(cap.stdout()).toContain('~ Editing src/server.ts');
  });

  it('identical inventory ⇒ byte-identical --json (deterministic, fresh runners)', async () => {
    const a = await runJson(normalScenario());
    const b = await runJson(normalScenario());
    expect(a.out).toBe(b.out);
  });
});

describe('exit codes + help/version (SPEC-001-AC-06/07/16)', () => {
  it('unknown flag → exit 2, message on stderr, empty stdout', async () => {
    const cap = makeIO();
    const code = await run(['--bogus'], { io: cap.io, deps: makeDeps(normalScenario()).deps });
    expect(code).toBe(2);
    expect(cap.stdout()).toBe('');
    expect(cap.stderr()).toContain('unknown flag');
  });

  it('--watch 0 → exit 2 (out of range)', async () => {
    const cap = makeIO();
    const code = await run(['--watch', '0'], { io: cap.io, deps: makeDeps(normalScenario()).deps });
    expect(code).toBe(2);
    expect(cap.stdout()).toBe('');
  });

  it('--help → exit 0, usage on stdout, no scan spawned', async () => {
    const { deps, log } = makeDeps(normalScenario());
    const cap = makeIO();
    const code = await run(['--help'], { io: cap.io, deps });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('Usage:');
    expect(log).toHaveLength(0); // no tmux/ps spawned
  });

  it('internal fatal error → exit 1, no partial JSON on stdout (SPEC-001-AC-07)', async () => {
    const { deps } = makeDeps(normalScenario());
    const badDeps = {
      ...deps,
      detectOrc: () => {
        throw new Error('boom');
      },
    };
    const cap = makeIO();
    const code = await run(['--json'], { io: cap.io, deps: badDeps });
    expect(code).toBe(1);
    expect(cap.stdout()).toBe(''); // no partial JSON
    expect(cap.stderr()).toContain('fatal');
  });

  it('--version → exit 0, semver on stdout', async () => {
    const cap = makeIO();
    const code = await run(['--version'], { io: cap.io, deps: makeDeps(normalScenario()).deps });
    expect(code).toBe(0);
    expect(cap.stdout().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('parseArgs maps the flag set', () => {
    expect(parseArgs(['--json']).json).toBe(true);
    expect(parseArgs(['--watch', '4']).watchIntervalS).toBe(4);
    expect(parseArgs(['--watch']).watch).toBe(true);
    expect(parseArgs(['--no-preview']).errors).toHaveLength(0); // reserved, no-op
    expect(parseArgs(['--zzz']).errors).toHaveLength(1);
  });
});

describe('TC-I-WATCH (SPEC-001-AC-08) — NDJSON + prior handoff + read-only across cycles', () => {
  it('--watch --json emits one JSON object per cycle (NDJSON)', async () => {
    const { deps } = makeDeps(normalScenario());
    const cap = makeIO();
    let n = 0;
    const code = await run(['--watch', '--json'], {
      io: cap.io,
      deps,
      sleep: async () => {},
      shouldContinue: () => n++ < 2,
    });
    expect(code).toBe(0);
    const lines = cap.stdout().trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('single-shot (no prior) does not assert HIGH-active or disappearance-terminated (SPEC-001-AC-09)', async () => {
    const scenario = normalScenario({ captures: { '%10': 'line one\nline two\nline three', '%11': '$ ' } });
    const { deps } = makeDeps(scenario);
    const runner = new ScanRunner(deps);
    const r = await runner.scanOnce(); // single-shot: prior is null
    const orc = r.camps[0]!.orcs[0]!;
    // change-diff cannot fire without a prior → no HIGH-confidence active
    expect(orc.status === 'active' && orc.statusConfidence >= 0.8).toBe(false);
    // disappearance-based terminated is impossible single-shot (no prior to compare)
    expect(orc.status).not.toBe('terminated');
  });

  it('a second cycle uses the prior fingerprint to confirm active; stays read-only', async () => {
    const scenario = normalScenario({ captures: { '%10': 'step one', '%11': '$ ' } });
    const { deps, log } = makeDeps(scenario);
    const runner = new ScanRunner(deps);
    await runner.scanOnce(); // single-shot: no prior
    scenario.captures!['%10'] = 'step one\nstep two — new work line';
    const r2 = await runner.scanOnce(); // prior present + meaningful change → active
    const orc = r2.camps[0]!.orcs[0]!;
    expect(orc.status).toBe('active');
    expect(orc.statusConfidence).toBeGreaterThanOrEqual(0.8);
    for (const call of log.filter((e) => e.file === 'tmux')) {
      const sub = call.args[0]!;
      expect(sub === '-V' || READONLY_ALLOWLIST.has(sub)).toBe(true);
    }
  });
});

describe('stale fallback + first-fail (SPEC-002-AC-11/12, SPEC-005-AC-07, SPEC-004-AC-10)', () => {
  it('inventory failure with last-good ⇒ stale, lastGoodAt preserved, orc status=stale', async () => {
    const scenario = normalScenario();
    const { deps } = makeDeps(scenario);
    const runner = new ScanRunner(deps);
    const r1 = await runner.scanOnce();
    scenario.inventoryFail = true;
    const r2 = await runner.scanOnce();
    expect(r2.stale).toBe(true);
    expect(r2.lastGoodAt).toBe(r1.scannedAt);
    expect(r2.camps[0]!.orcs[0]!.status).toBe('stale');
    expect(r2.diagnostics.tmuxErrors.length).toBeGreaterThan(0);
  });

  it('first failure with no last-good does not fabricate data', async () => {
    const { deps } = makeDeps(normalScenario({ inventoryFail: true }));
    const runner = new ScanRunner(deps);
    const r = await runner.scanOnce();
    expect(r.stale).toBe(false);
    expect(r.lastGoodAt).toBeNull();
    expect(r.camps).toHaveLength(0);
    expect(r.diagnostics.tmuxErrors.length).toBeGreaterThan(0);
  });
});
