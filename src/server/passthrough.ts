/**
 * SPEC-401 — interactive keyboard passthrough: server-side arm/disarm session,
 * exposure gate, keystroke rate cap, and the BATCHED per-session audit.
 *
 * This module owns the passthrough *security semantics*; it does NOT spawn tmux.
 * All egress still goes through SPEC-400 `controlExec` (the single writer) — the
 * ControlService calls `authorizeEgress`/`recordKeystroke` around each egress.
 *
 * Invariants (SPEC-401 §2.1/§2.9, D-043):
 *  - Observe = no egress: egress is authorized ONLY when a live arm-session with a
 *    matching `armSessionId` exists for the pane (else 409 not_armed).
 *  - armSessionId is a server-generated capability bound to the arming actor
 *    (single shared startup token → possession-based binding, §2.2 / §6 Q5).
 *  - Audit is one `control.passthrough_session` ActivityEvent per session at close:
 *    aggregate scalars only (keystrokeCount / durationMs / execFailures /
 *    inputRedactedFlag). NEVER a raw keystroke, literal text, key sequence, or token.
 */
import { generateToken } from './token';
import type { SnapshotRuntime } from './runtime';
import type { ActivityEvent } from './activity';

export const PASSTHROUGH_IDLE_MS = 240_000; // auto-disarm after inactivity (hypothesis, §3)
export const PASSTHROUGH_KEYSTROKE_RATE = 20; // max egress ops per second per session (hypothesis)

const ORC_ID_RE = /^pane:%[0-9]+$/;

/** The arm-time target snapshot re-validation is compared against (SPEC-400 §2.2). */
export interface ExpectedTarget {
  paneId: string;
  tmuxTarget: string;
  command: string;
  agentType: string;
}

export type CloseReason =
  | 'user_disarm'
  | 'idle_timeout'
  | 'superseded'
  | 'target_gone'
  | 'target_mismatch'
  | 'not_controllable'
  | 'exposure_off'
  | 'conn_closed'
  | 'server_stopping';

interface ArmSession {
  armSessionId: string; // capability (opaque, high-entropy) — never logged except as closed correlationId
  orcId: string;
  paneId: string;
  baseline: ExpectedTarget; // arm-time re-validation baseline
  armedAtMs: number;
  // audit accumulators — all NON-raw:
  keystrokeCount: number;
  execFailures: number;
  redactedFlag: boolean;
  keyHistogram: Record<string, number>; // accumulated but NOT serialized (default off, §2.9 Q6)
  // rate cap window:
  rateWindowStartMs: number;
  rateCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export type EgressAuth = { ok: true; session: ArmSession } | { ok: false; code: 'not_armed' | 'rate_limited' };

export interface ControlOutcomeResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface PassthroughOptions {
  idleMs?: number;
  keystrokeRate?: number;
}

export class PassthroughService {
  private sessions = new Map<string, ArmSession>(); // key: paneId (at-most-one, §2.2)
  private readonly idleMs: number;
  private readonly rate: number;

  constructor(
    private readonly runtime: SnapshotRuntime,
    private readonly now: () => Date = () => new Date(),
    opts: PassthroughOptions = {},
  ) {
    this.idleMs = opts.idleMs ?? PASSTHROUGH_IDLE_MS;
    this.rate = opts.keystrokeRate ?? PASSTHROUGH_KEYSTROKE_RATE;
  }

  /** POST /api/orcs/:orcId/passthrough/arm — no egress; re-validates + opens a session. */
  async arm(orcId: string, expected: ExpectedTarget): Promise<ControlOutcomeResponse> {
    if (!ORC_ID_RE.test(orcId)) return err(422, 'validation_error', 'invalid orcId');
    const paneId = orcId.slice('pane:'.length);
    if (expected.paneId !== paneId) return err(422, 'validation_error', 'expected.paneId mismatch');

    // D-044 — no blind writes: arming requires the global exposure gate on.
    if (!this.runtime.previewExposureEnabled()) return err(409, 'exposure_off', 'exposure disabled');
    if (this.runtime.snapshotVersion === 0) return err(503, 'snapshot_not_ready', 'snapshot not ready');
    const orc = this.runtime.getOrc(orcId);
    if (!orc) return err(404, 'orc_not_found', 'orc not found');
    if (orc.status === 'terminated' || orc.status === 'stale') return err(409, 'not_controllable', 'not controllable');

    const fresh = await this.runtime.revalidate(paneId);
    if (!fresh) return err(410, 'target_gone', 'target gone');
    if (fresh.tmuxTarget !== expected.tmuxTarget || fresh.command !== expected.command || fresh.agentType !== expected.agentType) {
      return err(409, 'target_mismatch', 'target mismatch');
    }

    const existing = this.sessions.get(paneId);
    if (existing) this.close(existing, 'superseded'); // duplicate arm → refresh (flush old)

    const nowMs = this.now().getTime();
    const session: ArmSession = {
      armSessionId: generateToken(),
      orcId,
      paneId,
      baseline: { paneId, tmuxTarget: fresh.tmuxTarget, command: fresh.command, agentType: fresh.agentType },
      armedAtMs: nowMs,
      keystrokeCount: 0,
      execFailures: 0,
      redactedFlag: false,
      keyHistogram: {},
      rateWindowStartMs: nowMs,
      rateCount: 0,
      idleTimer: null,
    };
    this.resetIdle(session);
    this.sessions.set(paneId, session);
    return { status: 200, body: { ok: true, armSessionId: session.armSessionId, orcId, paneId, idleTimeoutMs: this.idleMs } };
  }

  /** POST /api/orcs/:orcId/passthrough/disarm — flush the session audit. */
  disarm(orcId: string, armSessionId: unknown): ControlOutcomeResponse {
    if (!ORC_ID_RE.test(orcId)) return err(422, 'validation_error', 'invalid orcId');
    const paneId = orcId.slice('pane:'.length);
    const s = this.sessions.get(paneId);
    if (!s || typeof armSessionId !== 'string' || s.armSessionId !== armSessionId) {
      return err(404, 'not_armed', 'no matching arm-session');
    }
    const ev = this.close(s, 'user_disarm');
    return { status: 200, body: { ok: true, auditEventId: ev?.id ?? null } };
  }

  /** Authorize one passthrough egress: live session + matching capability + rate cap. */
  authorizeEgress(paneId: string, armSessionId: unknown): EgressAuth {
    const s = this.sessions.get(paneId);
    if (!s || typeof armSessionId !== 'string' || s.armSessionId !== armSessionId) return { ok: false, code: 'not_armed' };
    const nowMs = this.now().getTime();
    if (nowMs - s.rateWindowStartMs >= 1000) {
      s.rateWindowStartMs = nowMs;
      s.rateCount = 0;
    }
    if (s.rateCount >= this.rate) return { ok: false, code: 'rate_limited' };
    return { ok: true, session: s };
  }

  /** Accumulate one authorized egress into the session summary + reset idle timer. */
  recordKeystroke(
    session: ArmSession,
    ev: { action: 'input' | 'key'; key?: string; redacted?: boolean; execOk: boolean },
  ): void {
    session.rateCount += 1;
    session.keystrokeCount += 1;
    if (ev.action === 'key' && ev.key) session.keyHistogram[ev.key] = (session.keyHistogram[ev.key] ?? 0) + 1;
    if (ev.redacted) session.redactedFlag = true;
    if (!ev.execOk) session.execFailures += 1;
    this.resetIdle(session);
  }

  /** Close (auto-disarm / drift / shutdown) — flush audit if the session is still live. */
  closeForPane(paneId: string, reason: CloseReason): ActivityEvent | null {
    const s = this.sessions.get(paneId);
    return s ? this.close(s, reason) : null;
  }

  /** Flush every live session (server shutdown). */
  disposeAll(reason: CloseReason = 'server_stopping'): void {
    for (const s of [...this.sessions.values()]) this.close(s, reason);
  }

  private resetIdle(s: ArmSession): void {
    if (s.idleTimer) clearTimeout(s.idleTimer);
    const t = setTimeout(() => this.close(s, 'idle_timeout'), this.idleMs);
    if (typeof t.unref === 'function') t.unref();
    s.idleTimer = t;
  }

  private close(s: ArmSession, reason: CloseReason): ActivityEvent | null {
    if (s.idleTimer) {
      clearTimeout(s.idleTimer);
      s.idleTimer = null;
    }
    if (this.sessions.get(s.paneId) === s) this.sessions.delete(s.paneId);
    const durationMs = Math.max(0, this.now().getTime() - s.armedAtMs);
    // info for clean end (user/idle), warn for abnormal end (drift/supersede/exposure/conn).
    const severity = reason === 'user_disarm' || reason === 'idle_timeout' ? 'info' : 'warn';
    // keyHistogram is default-OFF (§2.9 Q6): accumulated internally, NEVER serialized here.
    return this.runtime.recordActivity({
      type: 'control.passthrough_session',
      severity,
      code: 'control.passthrough_session',
      target: { orcId: s.orcId, paneId: s.paneId },
      message: `passthrough session ${reason}`,
      detail: {
        keystrokeCount: s.keystrokeCount,
        durationMs,
        execFailures: s.execFailures,
        inputRedactedFlag: s.redactedFlag,
        reason,
        correlationId: s.armSessionId, // session is now closed → dead capability
      },
    });
  }
}

function err(status: number, code: string, message: string): ControlOutcomeResponse {
  return { status, body: { ok: false, error: { code, message } } };
}
