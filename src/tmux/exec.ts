/**
 * SPEC-006 §2.6 / §2.7 — hardened subprocess + read-only enforcement layer.
 *
 *  - `safeSpawn`  : the hardened spawn primitive (shell:false, fixed argv,
 *                   per-call timeout with SIGTERM→SIGKILL, never throws). Used by
 *                   BOTH the tmux path and the `ps` introspection path.
 *  - `tmuxExec`   : the ONLY tmux entry point. Fail-closed allowlist + secondary
 *                   state-changing denylist; binary fixed to exactly `tmux`.
 *  - `makeTmuxExec`: factory so tests can inject a fake spawn.
 *
 * Read-only is enforced here, not merely assumed: a non-allowlisted subcommand
 * THROWS before any process is spawned (AC-12 / T-07).
 */
import { spawn } from 'node:child_process';
import type { ProcessSpawn, SpawnResult, TmuxExecFn } from '../types';
import {
  READONLY_ALLOWLIST,
  STATE_CHANGING_DENYLIST,
  TMUX_TIMEOUT_MS,
} from '../types';

/** Grace period between SIGTERM and the SIGKILL escalation on timeout. */
const SIGKILL_GRACE_MS = 500;

/**
 * Hardened low-level spawn. Always `shell:false` with a fixed argv array (no
 * string interpolation, so no shell/command injection). On timeout the child is
 * SIGTERM'd then SIGKILL'd. NEVER throws on process failure — a spawn error
 * (e.g. ENOENT) or non-zero exit is reported in the returned {@link SpawnResult}.
 */
export const safeSpawn: ProcessSpawn = (file, args, opts) =>
  new Promise<SpawnResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (r: Omit<SpawnResult, 'durationMs'>): void => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ ...r, durationMs: Date.now() - start });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, { shell: false });
    } catch (err) {
      // Synchronous spawn failure (invalid args, etc.). Report, never throw.
      finish({
        stdout: '',
        stderr: '',
        exitCode: null,
        timedOut: false,
        spawnError: err as NodeJS.ErrnoException,
      });
      return;
    }

    const tt = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* process already gone */
      }
      const kt = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* process already gone */
        }
      }, SIGKILL_GRACE_MS);
      kt.unref?.();
      killTimer = kt;
    }, opts.timeoutMs);
    tt.unref?.();
    timeoutTimer = tt;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      stdout += d;
    });
    child.stderr?.on('data', (d: string) => {
      stderr += d;
    });

    // Async spawn failures (the usual ENOENT for a missing binary) arrive here.
    child.on('error', (err: NodeJS.ErrnoException) => {
      finish({ stdout, stderr, exitCode: null, timedOut, spawnError: err });
    });
    child.on('close', (code: number | null) => {
      finish({
        stdout,
        stderr,
        exitCode: timedOut ? null : code,
        timedOut,
        spawnError: null,
      });
    });
  });

/**
 * Build the single tmux entry point over an injected spawn primitive.
 *
 * Enforcement order (SPEC-006 §2.6):
 *   1. version probe: a null subcommand is valid ONLY as `['-V']`.
 *   2. fail-closed allowlist: subcommand ∉ READONLY_ALLOWLIST → throw (no spawn).
 *   3. secondary assert: subcommand ∈ STATE_CHANGING_DENYLIST → throw.
 *   4. spawn `tmux` with the fixed argv.
 *
 * The binary is fixed to exactly `tmux`; args are passed as an array (no shell).
 */
export function makeTmuxExec(
  spawnFn: ProcessSpawn,
  timeoutMs: number = TMUX_TIMEOUT_MS,
): TmuxExecFn {
  return (subcommand, args) => {
    if (subcommand === null) {
      // Only the version probe `tmux -V` may use a null subcommand.
      if (args.length !== 1 || args[0] !== '-V') {
        throw new Error(
          "tmuxExec: a null subcommand is only valid for the version probe ['-V']",
        );
      }
      return spawnFn('tmux', args, { timeoutMs });
    }

    // Fail-closed: anything not explicitly allow-listed is rejected, never spawned.
    if (!READONLY_ALLOWLIST.has(subcommand)) {
      throw new Error(
        `tmuxExec: subcommand "${subcommand}" is not in the read-only allowlist (fail-closed; not spawned)`,
      );
    }

    // Defense-in-depth: an explicit state-changing command is a hard error.
    if (STATE_CHANGING_DENYLIST.has(subcommand)) {
      throw new Error(
        `tmuxExec: subcommand "${subcommand}" is a state-changing command (denied)`,
      );
    }

    return spawnFn('tmux', [subcommand, ...args], { timeoutMs });
  };
}

/** The default, production tmux entry point: makeTmuxExec(safeSpawn). */
export const tmuxExec: TmuxExecFn = makeTmuxExec(safeSpawn);
