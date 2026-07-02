/**
 * SPEC-203 §2.6 — auto-disarm countdown (pure). The UI trusts the server's `idleTimeoutMs`
 * (from the arm response = PASSTHROUGH_IDLE_MS) and never invents its own value; each keystroke
 * resets `lastKeystrokeAt`. When `remainingMs <= 0` the client returns to Observe in step with the
 * server auto-disarm; near the threshold it shows a warning/countdown.
 */
export const DEFAULT_DISARM_WARN_MS = 30_000;

export interface IdleInput {
  idleTimeoutMs: number; // server value (arm response)
  lastKeystrokeAt: number; // epoch ms of the last egress keystroke (or armedAt)
  warnMs?: number; // show a countdown once remaining ≤ this (default 30s)
}

export interface IdleStatus {
  remainingMs: number; // clamped ≥ 0
  expired: boolean; // remaining hit 0 → auto-disarm
  warn: boolean; // within the warning window
}

export function idleStatus(input: IdleInput, now: number): IdleStatus {
  const warnMs = input.warnMs ?? DEFAULT_DISARM_WARN_MS;
  const remainingMs = Math.max(0, input.idleTimeoutMs - (now - input.lastKeystrokeAt));
  return { remainingMs, expired: remainingMs <= 0, warn: remainingMs <= warnMs };
}
