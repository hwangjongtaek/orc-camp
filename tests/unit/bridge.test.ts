/**
 * Unit tests for the SPEC-104 control-mode bridge (src/server/bridge.ts) with a fake
 * spawn + injected timer. Verifies the read-only / dirty-signal-only / bounded-reader
 * / death-detection invariants. NOTE: the bridge has NO stdin-write path in its
 * interface (BridgeProcess exposes only onData/onExit/kill) — the "stdin command
 * byte 0" invariant (§2.4) holds STRUCTURALLY: there is no API to write stdin.
 */
import { describe, expect, it } from 'vitest';
import { ControlModeBridge, buildBridgeArgv, type BridgeDeadReason, type BridgeProcess, type SpawnBridgeFn } from '../../src/server/bridge';

function harness() {
  const dirty: string[] = [];
  const layout: string[] = [];
  const dead: BridgeDeadReason[] = [];
  let starts = 0;
  let dataCb: ((c: string) => void) | null = null;
  let exitCb: ((code: number | null) => void) | null = null;
  let killed = 0;
  let argv: string[] = [];
  let scheduled: (() => void) | null = null;
  const spawn: SpawnBridgeFn = (a): BridgeProcess => {
    argv = a;
    return { onData: (cb) => { dataCb = cb; }, onExit: (cb) => { exitCb = cb; }, kill: () => { killed += 1; } };
  };
  const bridge = new ControlModeBridge(spawn, buildBridgeArgv([], '$0'), {
    onDirty: (p) => dirty.push(p),
    onLayoutChange: (w) => layout.push(w),
    onDead: (r) => dead.push(r),
    onStart: () => { starts += 1; },
  }, { setTimer: (fn) => { scheduled = fn; return { clear: () => { scheduled = null; } }; }, pauseStalenessMs: 100 });
  return {
    bridge, dirty, layout, dead, argv: () => argv,
    feed: (c: string) => dataCb?.(c),
    exit: (code: number | null) => exitCb?.(code),
    firePause: () => scheduled?.(),
    killed: () => killed,
    starts: () => starts,
  };
}

describe('buildBridgeArgv (SPEC-104 §2.2)', () => {
  it('fixed argv: socketArgs + -C attach-session + ignore-size', () => {
    expect(buildBridgeArgv([], '$0')).toEqual(['-C', 'attach-session', '-t', '$0', '-f', 'ignore-size']);
    expect(buildBridgeArgv(['-L', 'mysock'], '$3')).toEqual(['-L', 'mysock', '-C', 'attach-session', '-t', '$3', '-f', 'ignore-size']);
  });
});

describe('ControlModeBridge — dirty-signal parsing (§2.3)', () => {
  it('%output → onDirty(pane); the payload is drained, never surfaced', () => {
    const h = harness();
    h.feed('%output %2 hello\\015\\012 more octal payload\n');
    expect(h.dirty).toEqual(['%2']);
    // the bridge exposes no payload anywhere — only the pane id was emitted.
  });

  it('a secret in the %output payload never reaches any callback (structural)', () => {
    const h = harness();
    const secret = 'ghp_' + 'A'.repeat(20);
    h.feed(`%output %5 export TOKEN=${secret}\n`);
    expect(h.dirty).toEqual(['%5']);
    expect(JSON.stringify(h.dirty) + JSON.stringify(h.layout)).not.toContain(secret);
  });

  it('%output split across chunks + huge payload → one onDirty, bounded (no whole-line buffer)', () => {
    const h = harness();
    h.feed('%output %1 ');
    h.feed('x'.repeat(5_000_000)); // 5MB payload burst — must be drained, not buffered
    h.feed('tail\n%output %1 again\n');
    expect(h.dirty).toEqual(['%1', '%1']);
    expect(h.dead).toEqual([]); // huge PAYLOAD is fine (drained); only huge non-output lines are malformed
  });

  it('%window-pane-changed → onDirty(new active pane); %pane-mode-changed → onDirty; %layout-change → onLayoutChange', () => {
    const h = harness();
    h.feed('%window-pane-changed @0 %7\n%pane-mode-changed %7\n%layout-change @0 b25d,80x24,0,0,3\n');
    expect(h.dirty).toEqual(['%7', '%7']);
    expect(h.layout).toEqual(['@0']);
  });

  it('ignores unrelated notifications (%begin/%end/%client-*)', () => {
    const h = harness();
    h.feed('%begin 1 1 1\n%end 1 1 1\n%client-session-changed /dev/x $0 work\n');
    expect(h.dirty).toEqual([]);
    expect(h.dead).toEqual([]);
  });
});

describe('ControlModeBridge — death detection → fallback (§2.5)', () => {
  it('%exit → onDead(exit)', () => { const h = harness(); h.feed('%exit\n'); expect(h.dead).toEqual(['exit']); });
  it('stdout EOF (exit code 0) → onDead(eof)', () => { const h = harness(); h.exit(0); expect(h.dead).toEqual(['eof']); });
  it('process crash (non-zero) → onDead(crash)', () => { const h = harness(); h.exit(1); expect(h.dead).toEqual(['crash']); });
  it('spawn/runtime error (null code) → onDead(crash)', () => { const h = harness(); h.exit(null); expect(h.dead).toEqual(['crash']); });

  it('oversized non-newline notification line → onDead(malformed)', () => {
    const h = harness();
    h.feed('%weird ' + 'z'.repeat(5000)); // > MAX_NOTIFICATION_LINE, no newline
    expect(h.dead).toEqual(['malformed']);
  });

  it('prolonged %pause → onDead(pause_staleness); %continue cancels it', () => {
    const h1 = harness();
    h1.feed('%pause %0\n');
    h1.firePause();
    expect(h1.dead).toEqual(['pause_staleness']);

    const h2 = harness();
    h2.feed('%pause %0\n');
    h2.feed('%continue %0\n');
    h2.firePause(); // timer was cleared → no-op
    expect(h2.dead).toEqual([]);
  });

  it('dispose() kills the process and does NOT fire onDead (intentional teardown)', () => {
    const h = harness();
    h.bridge.dispose();
    expect(h.killed()).toBe(1);
    h.exit(0); // late EOF after intentional dispose → ignored
    expect(h.dead).toEqual([]);
  });

  it('onStart fires once at construction', () => { const h = harness(); expect(h.starts()).toBe(1); });
});
