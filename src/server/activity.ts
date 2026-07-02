/**
 * SPEC-600 §2.1–2.3 — ActivityEvent model + taxonomy + bounded ring buffer.
 *
 * User-facing operational events (scanner / status change / control / tmux error /
 * reconnect). Append-only, FIFO-evicted, memory-only. `message` is redaction-safe
 * metadata-only (never capture content); ordering authority is `seq`.
 */
export const ACTIVITY_CAPACITY = 500;
export const ACTIVITY_BOOTSTRAP_TAIL = 50;

export type ActivitySeverity = 'info' | 'warn' | 'error';

export type ActivityType =
  | 'scanner.started'
  | 'scanner.stale'
  | 'scanner.recovered'
  | 'scanner.error'
  | 'orc.status_changed'
  | 'orc.terminated'
  | 'control.result'
  | 'control.passthrough_session' // SPEC-401 §2.9 — arm-session summary (per-keystroke never emitted)
  | 'tmux.error'
  | 'connection.disconnected'
  | 'connection.reconnected'
  | 'server.started'
  | 'server.stopping';

export interface ActivityTarget {
  campId?: string;
  orcId?: string;
  paneId?: string;
  tmuxTarget?: string;
}

export interface ActivityDetail {
  correlationId?: string;
  outcome?: 'success' | 'failure';
  exitCode?: number;
  durationMs?: number;
  fromStatus?: string;
  toStatus?: string;
  action?: 'input' | 'key' | 'interrupt';
  controlOutcome?: 'success' | 'partial' | 'aborted' | 'failed';
  reason?: string;
  keyName?: string;
  inputByteLength?: number;
  inputRedactedFlag?: boolean;
  // SPEC-401 §2.9 / SPEC-600 §2.1 — control.passthrough_session aggregate scalars ONLY.
  // Never any raw keystroke / literal text / key sequence / token.
  keystrokeCount?: number;
  execFailures?: number;
  keyHistogram?: Record<string, number>; // allowlist key-name freq; opt-in (default off)
}

export interface ActivityEvent {
  id: string;
  seq: number;
  type: ActivityType;
  severity: ActivitySeverity;
  target: ActivityTarget | null;
  code: string;
  message: string; // redaction-safe, metadata-only
  detail?: ActivityDetail;
  createdAt: string;
  source: 'server' | 'client';
}

export interface NewActivity {
  type: ActivityType;
  severity: ActivitySeverity;
  code: string;
  message: string;
  target?: ActivityTarget | null;
  detail?: ActivityDetail;
}

export class ActivityLog {
  private buf: ActivityEvent[] = [];
  private seq = 0;

  constructor(
    private readonly now: () => Date,
    private readonly capacity: number = ACTIVITY_CAPACITY,
  ) {}

  push(e: NewActivity): ActivityEvent {
    this.seq += 1;
    const event: ActivityEvent = {
      id: `act:${this.seq}`,
      seq: this.seq,
      type: e.type,
      severity: e.severity,
      target: e.target ?? null,
      code: e.code,
      message: e.message,
      ...(e.detail ? { detail: e.detail } : {}),
      createdAt: this.now().toISOString(),
      source: 'server',
    };
    this.buf.push(event);
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
    return event;
  }

  tail(n: number): ActivityEvent[] {
    return this.buf.slice(-n);
  }
  size(): number {
    return this.buf.length;
  }
  clear(): void {
    this.buf = [];
  }
}
