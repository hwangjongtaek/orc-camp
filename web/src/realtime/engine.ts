/**
 * SPEC-200 §2.6 + SPEC-102 §3.1/§3.3 — realtime engine (client side).
 *
 * Bootstrap order (WS-first buffering, normative):
 *   1. token already captured (config/bootstrap) — engine assumes it exists.
 *   2. open WS, on `welcome` record runtimeEpoch and BUFFER subsequent state frames.
 *   3. GET /api/snapshot → applySnapshot (Vlast = Vs).
 *   4. drain: drop version ≤ Vs, apply version > Vs in order → bootstrapPhase 'live'.
 * Reconnect with exponential backoff+jitter; every reconnect re-snapshots (baseline reset);
 * runtimeEpoch change forces a full resync; gap/unknown-id → resync (re-fetch snapshot).
 * `disconnected` (transport) and `stale` (server flag) are tracked distinctly (R-UI-005).
 */
import type { ApiClient } from '../api/client';
import { getToken } from '../api/token';
import { useStore } from '../store/store';
import type {
  BatchPayload,
  HeartbeatPayload,
  StaleChangedPayload,
  WelcomePayload,
  WsFrame,
} from '../types/ws';
import { WS_CLOSE_TOKEN_INVALID } from '../types/ws';

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;
const BACKOFF_FACTOR = 2;
const RETRY_SNAPSHOT_MS = 1000;
const MISSED_HEARTBEAT_LIMIT = 2;

export class RealtimeEngine {
  private ws: WebSocket | null = null;
  private stopped = false;

  /** Frames received before the snapshot base is applied, or during a resync re-fetch. */
  private buffer: BatchPayload[] = [];
  private liveApply = false; // true once snapshot applied AND not currently (re)draining
  private draining = false;

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private livenessTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatIntervalMs = 15_000;

  constructor(
    private readonly api: ApiClient,
    private readonly wsBase: string,
  ) {}

  start(): void {
    this.stopped = false;
    this.openWs();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer('reconnect');
    this.clearTimer('liveness');
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  // --- WebSocket lifecycle ---------------------------------------------------

  private openWs(): void {
    if (this.stopped) return;
    const store = useStore.getState();
    store.setWsStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    const token = getToken();
    const protocols = token ? ['orc-camp.v1', `token.${token}`] : ['orc-camp.v1'];
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${this.wsBase}/api/events`, protocols);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onmessage = (ev) => this.onMessage(ev);
    ws.onclose = (ev) => this.onClose(ev.code);
    ws.onerror = () => {
      /* close handler does the reconnect bookkeeping */
    };
  }

  private onMessage(ev: MessageEvent): void {
    let frame: WsFrame;
    try {
      frame = JSON.parse(String(ev.data)) as WsFrame;
    } catch {
      return;
    }
    this.armLiveness();

    switch (frame.type) {
      case 'welcome':
        this.onWelcome(frame.payload as WelcomePayload);
        break;
      case 'batch':
        this.onBatch(frame.payload as BatchPayload);
        break;
      case 'server_stale_changed':
        this.onStaleChanged(frame.payload as StaleChangedPayload);
        break;
      case 'server_heartbeat':
        this.onHeartbeat(frame.payload as HeartbeatPayload);
        break;
      default:
        break;
    }
  }

  private onWelcome(payload: WelcomePayload): void {
    const store = useStore.getState();
    this.heartbeatIntervalMs = payload.heartbeatIntervalMs || this.heartbeatIntervalMs;
    this.reconnectAttempts = 0;
    store.setWsStatus('open');
    store.setBootstrapPhase('ws-open');
    store.setUnauthorized(false);
    store.setServerStale(payload.stale, payload.lastGoodAt);
    // runtimeEpoch is set authoritatively by the snapshot fetch below; record for restart logs.
    // Every welcome (initial or reconnect) re-snapshots to reset the baseline.
    this.buffer = [];
    this.liveApply = false;
    void this.fetchSnapshotAndDrain();
    this.armLiveness();
  }

  private onBatch(payload: BatchPayload): void {
    if (!this.liveApply) {
      this.buffer.push(payload);
      return;
    }
    const outcome = useStore.getState().applyBatchFrame(payload.version, payload.changes);
    if (outcome === 'resync-required') this.triggerResync();
  }

  private onStaleChanged(payload: StaleChangedPayload): void {
    const store = useStore.getState();
    store.setServerStale(payload.stale, payload.lastGoodAt);
    if (!this.liveApply) return;
    // A stale-only version bump carries no content changes; advance Vlast to avoid a
    // spurious gap, or resync if it indicates we actually missed intervening versions.
    const outcome = store.applyBatchFrame(payload.version, []);
    if (outcome === 'resync-required') this.triggerResync();
  }

  private onHeartbeat(payload: HeartbeatPayload): void {
    const store = useStore.getState();
    const { server } = store;
    store.setServerStale(payload.stale, server.lastGoodAt);
    if (this.liveApply && payload.version > store.connection.lastVersionApplied) {
      // We are behind (missed frames while connected) → resync.
      this.triggerResync();
    }
  }

  private onClose(code: number): void {
    this.ws = null;
    this.liveApply = false;
    this.clearTimer('liveness');
    if (this.stopped) return;

    const store = useStore.getState();
    if (code === WS_CLOSE_TOKEN_INVALID) {
      store.setUnauthorized(true);
      store.setWsStatus('disconnected');
      return; // do not reconnect: token is invalid (re-open boot URL)
    }
    store.setWsStatus('disconnected');
    this.scheduleReconnect();
  }

  // --- snapshot base + drain -------------------------------------------------

  private async fetchSnapshotAndDrain(): Promise<void> {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      // Retry loop for cold start (503) / transient errors; keep view in loading.
      // eslint-disable-next-line no-constant-condition
      while (!this.stopped) {
        const res = await this.api.getSnapshot();
        if (res.ok) {
          const store = useStore.getState();
          store.applySnapshot(res.data);
          this.drainBuffer();
          this.liveApply = true;
          this.draining = false;
          return;
        }
        if (res.status === 401) {
          useStore.getState().setUnauthorized(true);
          this.draining = false;
          return;
        }
        // 503 snapshot_not_ready or transient/network error → backoff and retry.
        const wait = res.retryAfterMs ?? RETRY_SNAPSHOT_MS;
        if (res.status !== 503) useStore.getState().setError(res.error);
        await delay(wait);
      }
    } finally {
      this.draining = false;
    }
  }

  private drainBuffer(): void {
    const store = useStore.getState();
    const frames = this.buffer;
    this.buffer = [];
    for (const f of frames) {
      const outcome = store.applyBatchFrame(f.version, f.changes);
      if (outcome === 'resync-required') {
        // Gap in buffered frames → schedule a fresh resync after this drain.
        queueMicrotask(() => this.triggerResync());
        return;
      }
    }
  }

  private triggerResync(): void {
    if (this.draining || this.stopped) return;
    this.liveApply = false; // buffer further frames until the new base is applied
    void this.fetchSnapshotAndDrain();
  }

  // --- reconnect + liveness --------------------------------------------------

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const attempt = this.reconnectAttempts++;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * BACKOFF_FACTOR ** attempt);
    const jitter = base * 0.25 * (Math.random() * 2 - 1);
    const wait = Math.max(BACKOFF_BASE_MS, Math.round(base + jitter));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openWs();
    }, wait);
  }

  /** Reset the missed-heartbeat watchdog; if it fires, force-close to trigger reconnect. */
  private armLiveness(): void {
    this.clearTimer('liveness');
    if (this.stopped) return;
    const window = this.heartbeatIntervalMs * MISSED_HEARTBEAT_LIMIT + 1000;
    this.livenessTimer = setTimeout(() => {
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          /* onclose will reconnect */
        }
      }
    }, window);
  }

  private clearTimer(which: 'reconnect' | 'liveness'): void {
    if (which === 'reconnect' && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (which === 'liveness' && this.livenessTimer) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  // --- manual refresh (R-API-004) -------------------------------------------

  async refresh(): Promise<void> {
    const store = useStore.getState();
    if (store.connection.refreshState === 'refreshing') return;
    store.setRefreshState('refreshing');
    const res = await this.api.refresh();
    if (res.ok) {
      store.applySnapshot(res.data);
      store.setRefreshState('idle');
      return;
    }
    if (res.status === 429) {
      store.setRefreshState('throttled');
      await delay(res.retryAfterMs ?? RETRY_SNAPSHOT_MS);
      store.setRefreshState('idle');
      return;
    }
    // Degrade fallback: refresh unavailable → re-fetch the last cycle snapshot.
    const snap = await this.api.getSnapshot();
    if (snap.ok) store.applySnapshot(snap.data);
    else store.setError(snap.error);
    store.setRefreshState('idle');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
