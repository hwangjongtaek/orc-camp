/**
 * SPEC-103 §2.2/§3.2/§3.3 + SPEC-203 §2.4/§2.5/§2.8 — live pane-view client controller.
 *
 * Owns the attach/detach LIFECYCLE and the reconstructed screen for the terminal viewport. It is
 * transport-agnostic (a `send` closure is injected by the RealtimeEngine) and exposes a
 * useSyncExternalStore-friendly `subscribe`/`getSnapshot` surface.
 *
 * Gating (SPEC-103 invariant ④): attach happens only when desired-orc ∧ tab-visible ∧ exposure-on
 * ∧ connected; if any drops, we detach immediately. Switching does detach(old)→attach(new)
 * (SPEC-203 §2.5). The previous orc's last redacted screen goes to a bounded LRU for instant
 * switch-back (shown STALE until the new seed) — but exposure-off PURGES the LRU wholesale so a
 * cached screen never bypasses the gate (SPEC-203 §2.5 precedence, AC-05/AC-10). Ordering is by
 * `viewSeq` only; a forward gap forces a re-attach (SPEC-103 §2.4). `pane_view_end` reasons map to
 * viewport states; `detached`/`tab_hidden` re-issue an explicit attach when conditions re-hold
 * (no server auto-resume, SPEC-203 §2.8).
 */
import type {
  PaneViewEndPayload,
  PaneViewEndReason,
  PaneViewPayload,
  PaneViewSeedPayload,
  ViewAttachPayload,
  ViewDetachPayload,
} from '../types/ws';
import { applyView, fromSeed, type PaneScreen } from './paneView';
import { LruCache } from '../terminal/lru';
import { TERMINAL_LRU_MAX } from '../config/constants';

/** Outbound live-view control frame (RealtimeEngine wraps + sends it). */
export type LiveViewSend =
  | { type: 'view.attach'; payload: ViewAttachPayload }
  | { type: 'view.detach'; payload: ViewDetachPayload };

export interface LiveViewSnapshot {
  /** The orc we currently WANT to watch (mirrors ?orc while terminal mode is active). */
  desiredOrcId: string | null;
  /** The orc we have an outstanding attach for on the current connection. */
  attachedOrcId: string | null;
  screen: PaneScreen | null; // null = loading (awaiting seed) / gated
  endReason: PaneViewEndReason | null;
  connected: boolean;
  /** Screen is not live (LRU cache or last-good after disconnect/gap). */
  stale: boolean;
  lastFrameAt: number | null; // epoch ms of the last seed/view (latency source)
}

const EMPTY: LiveViewSnapshot = {
  desiredOrcId: null,
  attachedOrcId: null,
  screen: null,
  endReason: null,
  connected: false,
  stale: false,
  lastFrameAt: null,
};

export class LiveViewController {
  private desiredOrcId: string | null = null;
  private attachedOrcId: string | null = null;
  private tabVisible = true;
  private exposureEnabled = false;
  private connected = false;

  private screen: PaneScreen | null = null;
  private endReason: PaneViewEndReason | null = null;
  private stale = false;
  private lastFrameAt: number | null = null;

  private readonly lru = new LruCache<string, PaneScreen>(TERMINAL_LRU_MAX);
  private readonly listeners = new Set<() => void>();
  private snap: LiveViewSnapshot = EMPTY;
  private readonly now: () => number;

  constructor(
    private readonly send: (frame: LiveViewSend) => void,
    now: () => number = () => Date.now(),
  ) {
    this.now = now;
    this.rebuild();
  }

  // --- external store surface ------------------------------------------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): LiveViewSnapshot => this.snap;

  // --- inputs from UI --------------------------------------------------------

  /** Terminal mode wants to watch `orcId` (null = terminal mode off / no selection). */
  setDesired(orcId: string | null): void {
    if (orcId === this.desiredOrcId) return;
    this.stashCurrentToLru();
    this.desiredOrcId = orcId;
    this.reconcile();
  }

  setTabVisible(visible: boolean): void {
    if (visible === this.tabVisible) return;
    this.tabVisible = visible;
    if (!visible) this.stashCurrentToLru();
    this.reconcile();
  }

  /** Global exposure toggle (SPEC-203 §2.5): off purges the LRU + clears the screen (gated). */
  setExposure(enabled: boolean): void {
    if (enabled === this.exposureEnabled) return;
    this.exposureEnabled = enabled;
    if (!enabled) {
      this.lru.clear(); // exposure off ALWAYS wins over the cache (AC-10)
      this.screen = null;
      this.stale = false;
    }
    this.reconcile();
  }

  // --- inputs from transport (RealtimeEngine) --------------------------------

  onWsOpen(): void {
    this.connected = true;
    this.attachedOrcId = null; // fresh connection: nothing attached server-side yet
    this.reconcile();
  }

  onWsClose(): void {
    this.connected = false;
    this.attachedOrcId = null;
    if (this.screen) this.stale = true; // keep last screen; mark not-live (disconnected overlay)
    this.rebuild();
  }

  onSeed(seed: PaneViewSeedPayload): void {
    if (seed.orcId !== this.desiredOrcId) return; // late frame for a superseded attach
    this.screen = fromSeed(seed);
    this.endReason = null;
    this.stale = false;
    this.lastFrameAt = this.now();
    this.rebuild();
  }

  onView(view: PaneViewPayload): void {
    if (view.orcId !== this.desiredOrcId || !this.screen) return;
    const outcome = applyView(this.screen, view);
    if (outcome.kind === 'applied') {
      this.screen = outcome.next;
      this.endReason = null;
      this.stale = false;
      this.lastFrameAt = this.now();
      this.rebuild();
    } else if (outcome.kind === 'gap') {
      this.stale = true; // lost frames → re-attach for a fresh seed (no partial resync)
      this.reattach();
    }
    // 'dropped' (duplicate/stale) → ignore
  }

  onEnd(end: PaneViewEndPayload): void {
    if (end.orcId !== this.attachedOrcId && end.orcId !== this.desiredOrcId) return;
    this.attachedOrcId = null;
    this.endReason = end.reason;
    if (end.reason === 'detached' || end.reason === 'tab_hidden') {
      // client-initiated / transient: re-issue an explicit attach if conditions still hold.
      this.reconcile();
      return;
    }
    if (end.reason === 'exposure_off') {
      this.lru.clear();
      this.screen = null;
      this.stale = false;
    }
    // pane_gone / superseded / error: surface the end state (viewport maps it, §2.8).
    this.rebuild();
  }

  // --- internal --------------------------------------------------------------

  private wantAttach(): string | null {
    return this.connected && this.tabVisible && this.exposureEnabled ? this.desiredOrcId : null;
  }

  private stashCurrentToLru(): void {
    // Keep only redacted screens (invariant ②) and only while exposure is on.
    if (this.attachedOrcId && this.screen && this.exposureEnabled) {
      this.lru.set(this.attachedOrcId, this.screen);
    }
  }

  private reconcile(): void {
    const want = this.wantAttach();
    if (want === this.attachedOrcId) {
      this.rebuild();
      return;
    }
    if (this.attachedOrcId) {
      this.send({ type: 'view.detach', payload: { orcId: this.attachedOrcId } });
    }
    this.attachedOrcId = want;
    if (want) {
      this.send({ type: 'view.attach', payload: { orcId: want } });
      const cached = this.exposureEnabled ? this.lru.get(want) : undefined;
      this.screen = cached ?? null;
      this.stale = cached !== undefined; // cached screen shows immediately, marked not-live
      this.endReason = null;
    } else {
      // Not attaching (no selection / gated / tab hidden / disconnected). Keep last screen only
      // when it's a transport gap; exposure-off already cleared it above.
      if (!this.screen) this.stale = false;
    }
    this.rebuild();
  }

  private reattach(): void {
    if (!this.attachedOrcId) {
      this.reconcile();
      return;
    }
    const orcId = this.attachedOrcId;
    this.send({ type: 'view.detach', payload: { orcId } });
    this.send({ type: 'view.attach', payload: { orcId } });
    this.rebuild();
  }

  private rebuild(): void {
    this.snap = {
      desiredOrcId: this.desiredOrcId,
      attachedOrcId: this.attachedOrcId,
      screen: this.screen,
      endReason: this.endReason,
      connected: this.connected,
      stale: this.stale,
      lastFrameAt: this.lastFrameAt,
    };
    for (const cb of this.listeners) cb();
  }
}
