/**
 * SPEC-002 §2.8 — optional, degradable process introspection (`pane_pid → ps`).
 *
 * Builds an {@link IntrospectFn} that reads a pane foreground process's argv
 * (`cmdline`) and liveness (`alive`) via a single READ-ONLY `ps` invocation.
 *
 * Safety contract (SPEC-002 §2.8 / SPEC-006 §2.7, D-019/D-020):
 *  - read-only: only ever `ps -o command= -p <pid>` (never a state-changing cmd).
 *  - fixed argv + shell-free: the pid is validated as a positive integer BEFORE
 *    being placed into the argv array; the injected {@link ProcessSpawn} enforces
 *    `shell:false`. No user text is ever interpolated into a command string.
 *  - per-call timeout: delegated to the injected spawn via `{ timeoutMs }`.
 *  - target(pid)-isolated & NEVER throws: any failure (no/invalid pid, spawn
 *    error, timeout, non-zero exit, empty output) degrades to nulls.
 *
 * The RAW cmdline is returned here; the inventory collector applies the single
 * `redact()` chokepoint (SPEC-006 §2.3) before any consumer sees it.
 */
import type { IntrospectFn, ProcessSpawn, SpawnResult } from '../types';
import { TMUX_TIMEOUT_MS } from '../types';

/** A pid is usable only if it is a finite, positive integer (injection-safe). */
function isValidPid(pid: number | null): pid is number {
  return pid !== null && Number.isInteger(pid) && pid > 0;
}

/**
 * Construct a read-only `ps` introspection function.
 *
 * @param spawn      hardened spawn primitive (shell:false, fixed argv, timeout)
 * @param timeoutMs  per-call timeout (defaults to the tmux per-command budget)
 */
export function makeIntrospect(
  spawn: ProcessSpawn,
  timeoutMs: number = TMUX_TIMEOUT_MS,
): IntrospectFn {
  return async (
    pid: number | null,
  ): Promise<{ cmdline: string | null; alive: boolean | null }> => {
    // pid absent/invalid → nothing to introspect (degradable, isolated).
    if (!isValidPid(pid)) {
      return { cmdline: null, alive: null };
    }

    // FIXED argv. pid is already validated as an integer; no shell, no interpolation.
    let result: SpawnResult;
    try {
      result = await spawn('ps', ['-o', 'command=', '-p', String(pid)], {
        timeoutMs,
      });
    } catch {
      // The injected spawn is hardened and should not throw; never propagate.
      return { cmdline: null, alive: null };
    }

    // Ambiguous outcomes → cannot decide liveness.
    if (result.timedOut || result.spawnError !== null) {
      return { cmdline: null, alive: null };
    }

    const cmdline = result.stdout.trim();

    if (result.exitCode === 0) {
      // exit 0 + non-empty argv ⇒ process exists and is alive.
      if (cmdline.length > 0) {
        return { cmdline, alive: true };
      }
      // exit 0 but empty output is unexpected/ambiguous.
      return { cmdline: null, alive: null };
    }

    // Clear failure: `ps -p <pid>` exits non-zero when the pid is not found.
    return { cmdline: null, alive: false };
  };
}
