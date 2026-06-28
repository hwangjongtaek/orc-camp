/**
 * SPEC-002 integration tests — drives collectInventory through a fake tmuxExec
 * backend (with an argv log) + fake introspect/redact/sanitize/clock. No live
 * tmux; fully deterministic (SPEC-007 §2.1/§2.2).
 */
import { describe, it, expect } from 'vitest';
import { CAPTURE_LINES, READONLY_ALLOWLIST, STATE_CHANGING_DENYLIST } from '../../src/types';
import type { CollectDeps, ProcessSnapshotEntry } from '../../src/types';
import { collectInventory } from '../../src/tmux/inventory';
import {
  INV_NORMAL,
  INV_NOT_INSTALLED,
  INV_NO_SERVER,
  INV_NO_SESSION,
  INV_NO_AGENT,
  INV_PARSE_ERR,
  INV_DEAD_PANE,
  INV_FIRST_FAIL,
  PANE_PIDS,
  GHP_TOKEN,
  makeFakeTmux,
  makeFakeProcessSnapshot,
  makeFakeRedact,
  makeFakeSanitize,
  now,
  type ExecCall,
  type InventoryFixture,
} from '../fixtures/inventory';

interface Harness {
  deps: CollectDeps;
  argvLog: ExecCall[];
  redactCalls: string[];
  sanitizeCalls: string[];
  snapshotCalls: { n: number };
}

function harness(
  fx: InventoryFixture,
  opts: {
    processTable?: ProcessSnapshotEntry[] | null;
    captureLines?: number;
  } = {},
): Harness {
  const { tmuxExec, argvLog } = makeFakeTmux(fx);
  const { processSnapshot, calls: snapshotCalls } = makeFakeProcessSnapshot(
    opts.processTable ?? null,
  );
  const { redact, calls: redactCalls } = makeFakeRedact();
  const { sanitize, calls: sanitizeCalls } = makeFakeSanitize();
  const deps: CollectDeps = {
    tmuxExec,
    processSnapshot,
    redact,
    sanitize,
    now,
    ...(opts.captureLines !== undefined ? { captureLines: opts.captureLines } : {}),
  };
  return { deps, argvLog, redactCalls, sanitizeCalls, snapshotCalls };
}

const tmuxSubs = (log: ExecCall[]) => log.map((c) => c.subcommand);

describe('SPEC-002-AC-01 — bulk inventory, one record per live pane', () => {
  it('calls list-sessions + list-panes -a and emits one record per live pane', async () => {
    const h = harness(INV_NORMAL);
    const r = await collectInventory(h.deps);

    expect(r.state).toBe('normal');
    expect(r.availability).toEqual({ installed: true, serverRunning: true, version: '3.3a' });
    expect(r.collectedOk).toBe(true);
    expect(r.collectedAt).toBe(now().toISOString());

    expect(tmuxSubs(h.argvLog)).toContain('list-sessions');
    expect(tmuxSubs(h.argvLog)).toContain('list-panes');
    // exactly one list-panes -a call (single authoritative bulk source)
    expect(h.argvLog.filter((c) => c.subcommand === 'list-panes')).toHaveLength(1);
    expect(h.argvLog.find((c) => c.subcommand === 'list-panes')?.args).toEqual([
      '-a',
      '-F',
      expect.any(String),
    ]);

    // 3 live panes → 3 records, deterministically sorted
    expect(r.panes).toHaveLength(3);
    expect(r.panes.map((p) => p.tmuxTarget)).toEqual([
      'play:0.0',
      'work:0.0',
      'work:0.1',
    ]);
    expect(r.sessions.map((s) => s.sessionName)).toEqual(['play', 'work']);
  });
});

describe('SPEC-002-AC-13/14 — read-only argv + capture form', () => {
  it('only ever spawns read-only subcommands (never a state-changing one)', async () => {
    const h = harness(INV_NORMAL);
    await collectInventory(h.deps);
    for (const call of h.argvLog) {
      if (call.subcommand === null) {
        expect(call.args).toEqual(['-V']); // version probe
        continue;
      }
      expect(READONLY_ALLOWLIST.has(call.subcommand)).toBe(true);
      expect(STATE_CHANGING_DENYLIST.has(call.subcommand)).toBe(false);
    }
    // exhaustive: the only subcommands present
    const set = new Set(tmuxSubs(h.argvLog));
    expect(set).toEqual(new Set([null, 'list-sessions', 'list-panes', 'capture-pane']));
  });

  it('capture-pane uses `-p -t <id> -S -N` with no `-e` (AC-14)', async () => {
    const h = harness(INV_NORMAL);
    await collectInventory(h.deps);
    const caps = h.argvLog.filter((c) => c.subcommand === 'capture-pane');
    expect(caps.length).toBe(3); // one per live pane
    for (const c of caps) {
      expect(c.args[0]).toBe('-p');
      expect(c.args[1]).toBe('-t');
      expect(c.args[2]).toMatch(/^%[0-9]+$/);
      expect(c.args[3]).toBe('-S');
      expect(c.args[4]).toBe(`-${CAPTURE_LINES}`);
      expect(c.args).not.toContain('-e');
    }
  });

  it('honors a custom captureLines', async () => {
    const h = harness(INV_NORMAL, { captureLines: 50 });
    await collectInventory(h.deps);
    const cap = h.argvLog.find((c) => c.subcommand === 'capture-pane');
    expect(cap?.args).toContain('-50');
  });
});

describe('SPEC-002 empty / availability states (AC-08/09/10)', () => {
  it('not_installed: probe ENOENT stops before inventory (AC-08)', async () => {
    const h = harness(INV_NOT_INSTALLED);
    const r = await collectInventory(h.deps);
    expect(r.state).toBe('not_installed');
    expect(r.availability).toEqual({ installed: false, serverRunning: false, version: null });
    expect(r.panes).toEqual([]);
    expect(r.errors).toEqual([]);
    // inventory/capture were never attempted
    expect(tmuxSubs(h.argvLog)).toEqual([null]);
  });

  it('server_not_running: list-sessions no-server stderr (AC-09)', async () => {
    const h = harness(INV_NO_SERVER);
    const r = await collectInventory(h.deps);
    expect(r.state).toBe('server_not_running');
    expect(r.availability).toEqual({ installed: true, serverRunning: false, version: '3.3a' });
    expect(r.panes).toEqual([]);
    expect(r.collectedOk).toBe(true);
    expect(r.errors).toEqual([]);
    expect(tmuxSubs(h.argvLog)).not.toContain('list-panes');
  });

  it('running_no_session: list-sessions exit 0 empty (AC-10)', async () => {
    const h = harness(INV_NO_SESSION);
    const r = await collectInventory(h.deps);
    expect(r.state).toBe('running_no_session');
    expect(r.availability).toEqual({ installed: true, serverRunning: true, version: '3.3a' });
    expect(r.panes).toEqual([]);
    expect(r.collectedOk).toBe(true);
    expect(tmuxSubs(h.argvLog)).not.toContain('list-panes');
  });

  it('no-agent: panes collected (detection is downstream)', async () => {
    const h = harness(INV_NO_AGENT);
    const r = await collectInventory(h.deps);
    expect(r.state).toBe('normal');
    expect(r.collectedOk).toBe(true);
    expect(r.panes).toHaveLength(2);
    expect(r.panes.map((p) => p.command)).toEqual(['zsh', 'vim']);
  });
});

describe('SPEC-002 parse_error + dead pane', () => {
  it('skips a malformed pane line and records a parse_error (no throw)', async () => {
    const h = harness(INV_PARSE_ERR);
    const r = await collectInventory(h.deps);
    expect(r.panes).toHaveLength(1);
    expect(r.panes[0]?.paneId).toBe('%0');
    expect(r.collectedOk).toBe(true);
    const parseErr = r.errors.find((e) => e.kind === 'parse_error');
    expect(parseErr).toMatchObject({
      phase: 'inventory',
      command: 'list-panes',
      kind: 'parse_error',
    });
  });

  it('dead pane: included as a record but never captured', async () => {
    const h = harness(INV_DEAD_PANE);
    const r = await collectInventory(h.deps);
    const dead = r.panes.find((p) => p.paneId === '%9');
    expect(dead?.paneDead).toBe(true);
    expect(dead?.capture).toBeNull();
    // capture-pane must NOT be called for the dead pane
    const capturedPanes = h.argvLog
      .filter((c) => c.subcommand === 'capture-pane')
      .map((c) => c.args[c.args.indexOf('-t') + 1]);
    expect(capturedPanes).toEqual(['%0']);
  });
});

describe('SPEC-002-AC-06/12 — inventory failure, no fabrication', () => {
  it('list-panes failure → diagnostics, collectedOk=false, panes=[] (no uncaught)', async () => {
    const h = harness(INV_FIRST_FAIL);
    const r = await collectInventory(h.deps);
    expect(r.collectedOk).toBe(false);
    expect(r.panes).toEqual([]);
    expect(r.sessions).toHaveLength(1); // sessions parsed before the failure
    const invErr = r.errors.find((e) => e.phase === 'inventory');
    expect(invErr).toMatchObject({
      phase: 'inventory',
      command: 'list-panes',
      kind: 'exit_nonzero',
      target: null,
    });
  });

  it('list-sessions timeout → inventory failure recorded, no throw (AC-04/06)', async () => {
    const h = harness({
      version: { stdout: 'tmux 3.3a\n' },
      listSessions: { timedOut: true },
    });
    const r = await collectInventory(h.deps);
    expect(r.collectedOk).toBe(false);
    expect(r.panes).toEqual([]);
    expect(r.availability.serverRunning).toBe(false);
    expect(r.errors.find((e) => e.phase === 'inventory')).toMatchObject({
      command: 'list-sessions',
      kind: 'timeout',
    });
  });
});

describe('SPEC-002-AC-04/05 — capture timeout + per-pane isolation', () => {
  it('one capture failure is isolated; other panes still present (no throw)', async () => {
    const h = harness({
      ...INV_NORMAL,
      captures: { '%1': { exitCode: 1, stderr: "can't find pane: %1" } },
    });
    const r = await collectInventory(h.deps);
    expect(r.panes).toHaveLength(3);
    const failed = r.panes.find((p) => p.paneId === '%1');
    const ok = r.panes.find((p) => p.paneId === '%2');
    expect(failed?.capture).toBeNull();
    expect(ok?.capture).not.toBeNull();

    const capErr = r.errors.find((e) => e.phase === 'capture');
    expect(capErr).toMatchObject({
      phase: 'capture',
      command: 'capture-pane',
      target: '%1',
      kind: 'exit_nonzero',
    });
    // message must not leak capture content (AC-07): it never includes stdout
    expect(capErr?.message).not.toContain(GHP_TOKEN);
    // the whole scan still succeeds
    expect(r.collectedOk).toBe(true);
  });

  it('capture timeout is recorded as kind=timeout, scan returns (AC-04)', async () => {
    const h = harness({
      ...INV_NORMAL,
      captures: { '%2': { timedOut: true } },
    });
    const r = await collectInventory(h.deps);
    expect(r.panes.find((p) => p.paneId === '%2')?.capture).toBeNull();
    expect(r.errors.find((e) => e.phase === 'capture')).toMatchObject({
      target: '%2',
      kind: 'timeout',
    });
  });
});

describe('SPEC-002-AC-15/16/18/21 — process subtree introspection (single snapshot)', () => {
  it('PROC-CMDLINE: cmdline (depth-0, redacted) + processAlive + processTree from ONE snapshot', async () => {
    const wrapperArgv = 'node /home/u/app/cli.js --token=' + GHP_TOKEN;
    const h = harness(INV_NORMAL, {
      processTable: [
        { pid: PANE_PIDS.workNode, ppid: 1, command: wrapperArgv },
        { pid: PANE_PIDS.workShell, ppid: 1, command: '-zsh' },
        { pid: PANE_PIDS.playVim, ppid: 1, command: 'vim' },
      ],
    });
    const r = await collectInventory(h.deps);
    const node = r.panes.find((p) => p.paneId === '%1');
    expect(node?.processAlive).toBe(true);
    expect(node?.cmdline).toBe('node /home/u/app/cli.js --token=[REDACTED:token]');
    // raw argv secret never survives the redaction chokepoint (depth-0 node redacted too)
    expect(node?.cmdline).not.toContain(GHP_TOKEN);
    expect(node?.processTree?.[0]?.command).toBe('node /home/u/app/cli.js --token=[REDACTED:token]');
    expect(node?.processTree?.[0]?.depth).toBe(0);
    // SPEC-002-AC-21: ONE ps snapshot for ALL panes (O(1) spawn, not per-pane)
    expect(h.snapshotCalls.n).toBe(1);
  });

  it('PROC-SUBTREE (AC-18): wrapper-chain agent argv in a DESCENDANT node is exposed', async () => {
    // zsh(1000) → claude(2000) → npm(2001) → node(2002): agent argv only in a descendant.
    const h = harness(INV_NORMAL, {
      processTable: [
        { pid: PANE_PIDS.workShell, ppid: 1, command: '-zsh' },
        { pid: 2000, ppid: PANE_PIDS.workShell, command: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js' },
        { pid: 2001, ppid: 2000, command: 'npm exec' },
        { pid: 2002, ppid: 2001, command: 'node worker.js' },
      ],
    });
    const r = await collectInventory(h.deps);
    const shell = r.panes.find((p) => p.paneId === '%0');
    expect(shell?.processTree).toHaveLength(4);
    expect(shell?.processTree?.map((n) => n.depth)).toEqual([0, 1, 2, 3]);
    expect(shell?.processTree?.[0]?.command).toBe('-zsh'); // depth-0 = pane_pid
    expect(shell?.processTree?.some((n) => n.command.includes('@anthropic-ai/claude-code'))).toBe(true);
  });

  it('TC-I-PROC-SUBTREE-SECRET (SPEC-006-AC-18): a secret in a NON-foreground node is redacted', async () => {
    // secret lives in a depth-2 descendant argv (not the pane_pid/foreground node).
    const secretArgv = 'node /run.js --token=' + GHP_TOKEN;
    const h = harness(INV_NORMAL, {
      processTable: [
        { pid: PANE_PIDS.workShell, ppid: 1, command: '-zsh' },
        { pid: 3000, ppid: PANE_PIDS.workShell, command: 'npm exec' },
        { pid: 3001, ppid: 3000, command: secretArgv },
      ],
    });
    const r = await collectInventory(h.deps);
    const shell = r.panes.find((p) => p.paneId === '%0');
    const allNodeArgv = (shell?.processTree ?? []).map((n) => n.command).join('\n');
    // every node argv passed redact() — the non-foreground secret is masked, no raw leak
    expect(allNodeArgv).not.toContain(GHP_TOKEN);
    expect(shell?.processTree?.[2]?.command).toBe('node /run.js --token=[REDACTED:token]');
    expect(h.redactCalls.some((c) => c.includes(GHP_TOKEN))).toBe(true); // raw seen only at the boundary
  });

  it('PROC-FAIL: snapshot null → cmdline/processAlive/processTree null, panes still collected', async () => {
    const h = harness(INV_NORMAL, { processTable: null });
    const r = await collectInventory(h.deps);
    expect(r.panes).toHaveLength(3);
    for (const p of r.panes) {
      expect(p.cmdline).toBeNull();
      expect(p.processAlive).toBeNull();
      expect(p.processTree).toBeNull();
    }
    // still only one snapshot attempt for the whole scan
    expect(h.snapshotCalls.n).toBe(1);
  });
});

describe('SPEC-006 chokepoint wiring — redact/sanitize are actually invoked', () => {
  it('title/cwd → redact; cmdline (depth-0 argv) → redact; capture → sanitize; command RAW', async () => {
    const h = harness(INV_NORMAL, {
      processTable: [{ pid: PANE_PIDS.workShell, ppid: 1, command: 'node /x/a.js' }],
    });
    const r = await collectInventory(h.deps);

    const shell = r.panes.find((p) => p.paneId === '%0');
    expect(shell).toBeDefined();

    // redact invoked on the raw title and raw cwd
    expect(h.redactCalls).toContain('shell'); // raw paneTitle
    expect(h.redactCalls).toContain('/home/u/work'); // raw cwd
    expect(h.redactCalls).toContain('node /x/a.js'); // raw cmdline

    // sanitize invoked on the raw capture buffer (which held the secret)
    expect(h.sanitizeCalls.some((c) => c.includes(GHP_TOKEN))).toBe(true);

    // command passes through RAW (NOT redacted)
    expect(shell?.command).toBe('zsh');

    // the planted secret is masked in the sanitized capture and absent from output
    const capText = (shell?.capture?.lines ?? []).join('\n');
    expect(capText).not.toContain(GHP_TOKEN);
    expect(capText).toContain('[REDACTED:github-token]');
  });

  it('empty pane title becomes null without an unnecessary redact call', async () => {
    const h = harness(INV_NO_AGENT); // %0 has empty title
    const r = await collectInventory(h.deps);
    const p0 = r.panes.find((p) => p.paneId === '%0');
    expect(p0?.paneTitle).toBeNull();
    expect(h.redactCalls).not.toContain(''); // empty title not pushed through redact
  });
});

describe('determinism', () => {
  it('same fixture + injected clock ⇒ identical result', async () => {
    const a = await collectInventory(harness(INV_NORMAL).deps);
    const b = await collectInventory(harness(INV_NORMAL).deps);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
