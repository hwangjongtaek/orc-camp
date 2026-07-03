/**
 * SPEC-104 — control-mode bridge: resident `tmux -C attach` low-latency TRIGGER.
 *
 * The bridge makes NO frames and issues NO tmux commands (effective
 * BRIDGE_COMMAND_ALLOWLIST = ∅, D-048). It attaches in control mode, reads the
 * `%*` notification stream on stdout, and consumes it as a DIRTY-SIGNAL ONLY:
 *  - `%output %<pane> …` → mark that pane dirty; the octal-escaped text payload is
 *    NEVER buffered whole, redacted, logged, or turned into frame content (D-047 /
 *    §2.3 P1-E). We parse the `%output %<pane>` prefix and DRAIN the rest of the line
 *    without accumulating it.
 *  - `%window-pane-changed`/`%pane-mode-changed` → pane dirty; `%layout-change` →
 *    window-scoped dirty.
 * The child's stdin handle is private to this module and is NEVER written (only
 * closed on intentional teardown) — this stdin single-writer/allowlist=∅ is the
 * read-only defense line (§2.4 P0-A/P0-B). Any death (EOF / `%exit` / crash /
 * malformed / prolonged `%pause`) invokes `onDead` → the caller silently falls back
 * to SPEC-103 polling (D-049). Frame production stays entirely in SPEC-103.
 */

import { spawn as nodeSpawn } from 'node:child_process';

export type BridgeDeadReason = 'eof' | 'exit' | 'crash' | 'malformed' | 'pause_staleness';

export interface BridgeCallbacks {
  onDirty: (paneId: string) => void; // pane-scoped change (%output / %window-pane-changed / %pane-mode-changed)
  onLayoutChange: (windowId: string) => void; // window-scoped change (%layout-change → all panes of window)
  onDead: (reason: BridgeDeadReason) => void; // any death → caller re-arms polling
  onStart?: () => void;
}

/**
 * A spawned control-mode process (injectable for tests). The bridge never receives
 * a writable stdin handle here — read-only by construction at this seam; the real
 * spawn keeps stdin open (EOF = tmux detach) and closes it only on kill().
 */
export interface BridgeProcess {
  onData: (cb: (chunk: string) => void) => void; // raw stdout chunks (NOT pre-split — bounded parse is ours)
  onExit: (cb: (code: number | null) => void) => void;
  kill: () => void; // intentional teardown: closes stdin + terminates
}
export type SpawnBridgeFn = (argv: string[]) => BridgeProcess;

/** Hypotheses (§6 Q1) — calibrated by SPEC-007. */
export const BRIDGE_MIN_CAPTURE_INTERVAL_MS = 60; // < PANE_VIEW_INTERVAL_MS, > 0 (backpressure floor)
export const BRIDGE_PAUSE_STALENESS_MS = 2000; // prolonged %pause → degrade to polling
const MAX_NOTIFICATION_LINE = 4096; // bounded reader cap for buffered (non-%output) lines
const MAX_OUTPUT_PREFIX = 64; // a `%output %<pane> ` prefix is short; longer w/o match = malformed

/** Fixed argv (§2.2): tmuxExec's socket specifier + control-mode attach + ignore-size. */
export function buildBridgeArgv(socketArgs: string[], sessionTarget: string): string[] {
  return [...socketArgs, '-C', 'attach-session', '-t', sessionTarget, '-f', 'ignore-size'];
}

/**
 * Real resident-process spawner (§2.2): `tmux <argv>`, shell:false, stderr ignored.
 * stdin is a pipe held OPEN and NEVER written — closing it (only on kill) is a tmux
 * detach (EOF). The child.stdin handle is captured in this closure and exposed to NO
 * caller: the structural sole-writer (P0-B(i)); no `.write()` call exists.
 */
export function makeBridgeSpawn(): SpawnBridgeFn {
  return (argv) => {
    const child = nodeSpawn('tmux', argv, { stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    let onData: ((c: string) => void) | null = null;
    let onExit: ((code: number | null) => void) | null = null;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => onData?.(c));
    child.on('exit', (code) => onExit?.(code));
    child.on('error', () => onExit?.(null)); // spawn/runtime error → crash
    return {
      onData: (cb) => { onData = cb; },
      onExit: (cb) => { onExit = cb; },
      kill: () => { try { child.stdin?.end(); child.kill('SIGTERM'); } catch { /* already gone */ } },
    };
  };
}

const PANE_TOK = '[%][0-9]+';
const OUTPUT_PREFIX_RE = new RegExp(`^%output (${PANE_TOK}) `);
const WIN_PANE_RE = new RegExp(`^%window-pane-changed (@[0-9]+) (${PANE_TOK})`);
const LAYOUT_RE = /^%layout-change (@[0-9]+)/;
const PANE_MODE_RE = new RegExp(`^%pane-mode-changed (${PANE_TOK})`);

export class ControlModeBridge {
  private disposed = false;
  private dead = false;
  private buf = '';
  private draining = false; // inside a %output payload — discard to newline, no buffering
  private pauseTimer: { clear: () => void } | null = null;
  private readonly proc: BridgeProcess;
  private readonly setTimer: (fn: () => void, ms: number) => { clear: () => void };
  private readonly pauseMs: number;

  constructor(
    spawn: SpawnBridgeFn,
    argv: string[],
    private readonly cb: BridgeCallbacks,
    opts: { setTimer?: (fn: () => void, ms: number) => { clear: () => void }; pauseStalenessMs?: number } = {},
  ) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); if (typeof t.unref === 'function') t.unref(); return { clear: () => clearTimeout(t) }; });
    this.pauseMs = opts.pauseStalenessMs ?? BRIDGE_PAUSE_STALENESS_MS;
    this.proc = spawn(argv);
    this.proc.onData((c) => this.feed(c));
    this.proc.onExit((code) => { if (!this.disposed) this.die(code === 0 ? 'eof' : 'crash'); });
    this.cb.onStart?.();
  }

  /** Intentional teardown (§2.5): kill the process (closes stdin); no onDead. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPause();
    this.proc.kill();
  }

  private die(reason: BridgeDeadReason): void {
    if (this.dead || this.disposed) return;
    this.dead = true;
    this.clearPause();
    this.proc.kill();
    this.cb.onDead(reason);
  }

  /**
   * Bounded incremental parser. `%output` lines are drained (prefix parsed, payload
   * discarded byte-for-byte, never accumulated); other notification lines are
   * buffered up to MAX_NOTIFICATION_LINE (bounded) and parsed on newline.
   */
  private feed(chunk: string): void {
    if (this.disposed || this.dead) return;
    this.buf += chunk;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.draining) {
        const nl = this.buf.indexOf('\n');
        if (nl === -1) { this.buf = ''; return; } // discard payload, keep draining — NO buffering
        this.buf = this.buf.slice(nl + 1);
        this.draining = false;
        continue;
      }
      // Fast path: a `%output` line → parse prefix, then drain the payload.
      if (this.buf.startsWith('%output') || '%output'.startsWith(this.buf)) {
        const m = OUTPUT_PREFIX_RE.exec(this.buf);
        if (m) {
          this.cb.onDirty(m[1]!);
          this.buf = this.buf.slice(m[0].length);
          this.draining = true;
          continue;
        }
        // prefix incomplete: wait for more, unless it is implausibly long (malformed).
        if (this.buf.length > MAX_OUTPUT_PREFIX && !this.buf.includes('\n')) { this.die('malformed'); return; }
        if (!this.buf.includes('\n')) return;
        // has a newline but didn't match %output prefix → fall through to line parse.
      }
      const nl = this.buf.indexOf('\n');
      if (nl === -1) {
        if (this.buf.length > MAX_NOTIFICATION_LINE) this.die('malformed');
        return;
      }
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.parseLine(line);
      if (this.dead || this.disposed) return;
    }
  }

  /** Parse ONE complete non-%output notification line. Structural facts only. */
  private parseLine(line: string): void {
    if (line.startsWith('%exit')) { this.die('exit'); return; }
    if (line.startsWith('%pause')) { this.armPause(); return; }
    if (line.startsWith('%continue')) { this.clearPause(); return; }
    let m = WIN_PANE_RE.exec(line);
    if (m) { this.cb.onDirty(m[2]!); return; } // active-pane-changed (focus) — the NEW active pane
    m = PANE_MODE_RE.exec(line);
    if (m) { this.cb.onDirty(m[1]!); return; }
    m = LAYOUT_RE.exec(line);
    if (m) { this.cb.onLayoutChange(m[1]!); return; }
    // %begin/%end/%error/%client-*/%session-* etc. — ignored (bridge issues no commands).
  }

  private armPause(): void {
    if (this.pauseTimer) return;
    this.pauseTimer = this.setTimer(() => this.die('pause_staleness'), this.pauseMs);
  }
  private clearPause(): void {
    if (this.pauseTimer) { this.pauseTimer.clear(); this.pauseTimer = null; }
  }
}
