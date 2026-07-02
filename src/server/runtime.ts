/**
 * SPEC-101 §2.1–2.3 — snapshot runtime (serve-mode scan loop).
 *
 * Wraps the PoC ScanRunner: scans on an interval (single in-flight, coalesced),
 * bumps snapshotVersion only on a content change (diff), keeps the last published
 * snapshot + liveness + a small recent-activity tail in memory. All read accessors
 * serve the current published snapshot; preview text is gated (token by the route,
 * exposure here).
 */
import { PREVIEW_LINES, type AgentType, type Camp, type Orc, type ScanResult } from '../types';
import { capturePaneView, type PaneViewCapture } from './pane-view';
import { ScanRunner, type ScanRuntimeDeps } from '../scan';
import { collectInventory } from '../tmux/inventory';
import { diffSnapshots, snapshotChanged, type DiffEvent } from './diff';
import { ACTIVITY_BOOTSTRAP_TAIL, ActivityLog, type ActivityEvent, type NewActivity } from './activity';
import type { DebugLog } from './debug-log';
import type { SettingsProvider } from './settings';
import type { HealthResponse, OrcPreviewResponse, SnapshotResponse } from './types';

/** SPEC-102 runtime → WS frames (envelope added by the WS layer). */
export type RuntimeEvent =
  | { type: 'batch'; version: number; changes: DiffEvent[] }
  | { type: 'server_stale_changed'; stale: boolean; lastGoodAt: string | null; version: number }
  | { type: 'activity'; event: ActivityEvent };

export interface RuntimeOptions {
  deps: ScanRuntimeDeps;
  settings: SettingsProvider; // live source (scanInterval/preview read each use)
  runtimeEpoch: string;
  now: () => Date;
  debugLog?: DebugLog; // SPEC-600 — optional structured debug log
}

export class SnapshotRuntime {
  private runner: ScanRunner;
  private published: ScanResult | null = null;
  private version = 0;
  private lastScanAt: string | null = null;
  private lastScanOk = false;
  private activityLog: ActivityLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private scanning: Promise<ScanResult | null> | null = null;
  private startedAtMs: number;
  private startedAtIso: string;
  private listeners = new Set<(e: RuntimeEvent) => void>();

  constructor(private readonly opts: RuntimeOptions) {
    this.runner = new ScanRunner(opts.deps);
    const d = opts.now();
    this.startedAtMs = d.getTime();
    this.startedAtIso = d.toISOString();
    this.activityLog = new ActivityLog(opts.now);
  }

  /** SPEC-102 — subscribe to runtime change frames (returns an unsubscribe fn). */
  subscribe(fn: (e: RuntimeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: RuntimeEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Connection-time state for the WS welcome frame (SPEC-102 §2.6). */
  welcomeState(): { version: number; stale: boolean; lastGoodAt: string | null; runtimeEpoch: string; serverStartedAt: string } {
    return {
      version: this.version,
      stale: this.published?.stale ?? false,
      lastGoodAt: this.published?.lastGoodAt ?? null,
      runtimeEpoch: this.opts.runtimeEpoch,
      serverStartedAt: this.startedAtIso,
    };
  }
  currentStale(): boolean {
    return this.published?.stale ?? false;
  }

  get runtimeEpoch(): string {
    return this.opts.runtimeEpoch;
  }
  get snapshotVersion(): number {
    return this.version;
  }
  get scannerRunning(): boolean {
    return !this.stopped;
  }

  /** First scan (first publish) + schedule the interval loop. */
  async start(): Promise<void> {
    this.pushActivity({ type: 'server.started', severity: 'info', code: 'server.started', message: 'server started' });
    await this.runScan();
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runScan().finally(() => this.schedule());
    }, this.opts.settings.effective().scanIntervalS * 1000); // live-reload: read each cycle
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Run a scan cycle; coalesce concurrent callers onto the in-flight scan. */
  async runScan(): Promise<ScanResult | null> {
    if (this.scanning) return this.scanning;
    this.scanning = this.doScan().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  private async doScan(): Promise<ScanResult | null> {
    const next = await this.runner.scanOnce();
    this.lastScanAt = next.scannedAt;
    const inventoryFailed =
      next.stale || next.diagnostics.tmuxErrors.some((e) => e.phase === 'inventory' || e.phase === 'probe');
    this.lastScanOk = !inventoryFailed;
    const prior = this.published;
    const wasStale = prior?.stale ?? false;

    // scanner lifecycle activity (transitions only — not per cycle)
    if (next.stale && !wasStale) this.pushActivity({ type: 'scanner.stale', severity: 'warn', code: 'scanner.stale', message: 'scanner stale — serving last-good snapshot', detail: { durationMs: next.diagnostics.scanDurationMs } });
    else if (!next.stale && wasStale) this.pushActivity({ type: 'scanner.recovered', severity: 'info', code: 'scanner.recovered', message: 'scanner recovered', detail: { durationMs: next.diagnostics.scanDurationMs } });
    else if (inventoryFailed && !next.stale) this.pushActivity({ type: 'scanner.error', severity: 'error', code: 'scanner.inventory_failed', message: 'scan inventory failed', detail: { durationMs: next.diagnostics.scanDurationMs } });

    // tmux errors → debug log (redaction-before-write) + tmux.error activity
    for (const e of next.diagnostics.tmuxErrors) {
      this.opts.debugLog?.write({
        level: e.kind === 'timeout' ? 'warn' : 'error', component: 'tmux', code: `tmux.${e.kind}`, phase: e.phase, command: e.command,
        ...(e.target ? { paneId: e.target } : {}), ...(e.exitCode !== null ? { exitCode: e.exitCode } : {}), message: e.message,
      });
      this.pushActivity({ type: 'tmux.error', severity: e.kind === 'timeout' ? 'warn' : 'error', code: `tmux.${e.kind}`, target: e.target ? { paneId: e.target } : null, message: `tmux ${e.command} ${e.kind}`, detail: e.exitCode !== null ? { exitCode: e.exitCode } : {} });
    }

    if (snapshotChanged(prior, next)) {
      const changes = diffSnapshots(prior, next);
      this.published = next;
      this.version += 1;
      if (changes.length > 0) this.emit({ type: 'batch', version: this.version, changes });
      if (wasStale !== next.stale) this.emit({ type: 'server_stale_changed', stale: next.stale, lastGoodAt: next.lastGoodAt, version: this.version });
      for (const c of changes) {
        if (c.type === 'orc_status_changed') {
          const p = c.payload as { orcId: string; campId: string; status: string; fromStatus?: string };
          this.pushActivity({ type: 'orc.status_changed', severity: 'info', code: `status.${p.status}`, target: { orcId: p.orcId, campId: p.campId }, message: `orc ${p.orcId} → ${p.status}`, detail: { toStatus: p.status, ...(p.fromStatus ? { fromStatus: p.fromStatus } : {}) } });
        } else if (c.type === 'orc_removed') {
          const p = c.payload as { orcId: string; campId: string; reason: string };
          this.pushActivity({ type: 'orc.terminated', severity: 'info', code: 'orc.removed', target: { orcId: p.orcId, campId: p.campId }, message: `orc ${p.orcId} removed`, detail: { reason: p.reason } });
        }
      }
    }
    return this.published;
  }

  /** Manual refresh (SPEC-101 §2.8) — out-of-cycle scan, coalesced. */
  async refresh(): Promise<SnapshotResponse | null> {
    await this.runScan();
    return this.getSnapshot();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.published = null;
    this.activityLog.clear();
  }

  private pushActivity(a: NewActivity): ActivityEvent {
    const event = this.activityLog.push(a);
    this.emit({ type: 'activity', event });
    return event;
  }

  /** Public activity recorder (SPEC-400 control audit → control.result event). */
  recordActivity(a: NewActivity): ActivityEvent {
    return this.pushActivity(a);
  }

  /** Find an orc by stable id in the current published snapshot. */
  getOrc(orcId: string): Orc | null {
    if (this.published === null) return null;
    return this.published.camps.flatMap((c) => c.orcs).find((o) => o.id === orcId) ?? null;
  }

  /**
   * SPEC-400 §2.6 — fresh read-only re-validation of a pane at execution time
   * (never trusts the cached snapshot). Returns null if the pane no longer exists.
   */
  async revalidate(paneId: string): Promise<{ paneId: string; tmuxTarget: string; command: string; agentType: AgentType } | null> {
    const d = this.opts.deps;
    const inv = await collectInventory({
      tmuxExec: d.tmuxExec, processSnapshot: d.processSnapshot, sanitize: d.sanitize, redact: d.redact, now: d.now,
      ...(d.timeoutMs !== undefined ? { timeoutMs: d.timeoutMs } : {}),
      ...(d.captureLines !== undefined ? { captureLines: d.captureLines } : {}),
    });
    const pane = inv.panes.find((p) => p.paneId === paneId);
    if (!pane) return null;
    const cand = d.detectOrc(
      { paneId: pane.paneId, tmuxTarget: pane.tmuxTarget, command: pane.command, paneTitle: pane.paneTitle, cmdline: pane.cmdline, processTree: pane.processTree ?? null, cwd: pane.cwd, recentOutput: pane.capture ? pane.capture.lines : [] },
      d.detectors,
    );
    return { paneId: pane.paneId, tmuxTarget: pane.tmuxTarget, command: pane.command, agentType: cand?.agentType ?? 'unknown' };
  }

  /** Bootstrap tail for new clients (SPEC-600 §2.4). */
  activityTail(n: number = ACTIVITY_BOOTSTRAP_TAIL): ActivityEvent[] {
    return this.activityLog.tail(n);
  }

  // --- SPEC-103 live pane view (read-only high-freq channel) ---

  /** Global preview exposure gate (D-044) — live view attach inherits it. */
  previewExposureEnabled(): boolean {
    return this.opts.settings.effective().preview.exposureEnabled;
  }

  /**
   * One read-only live capture tick for a pane (SPEC-103 §2.5). Reuses the scan
   * deps' `tmuxExec`/`sanitize` (READONLY_ALLOWLIST list-panes+capture-pane); raw
   * is discarded inside `capturePaneView`. Independent of the scan loop.
   */
  captureLivePaneView(paneId: string): Promise<PaneViewCapture> {
    const d = this.opts.deps;
    return capturePaneView(
      { tmuxExec: d.tmuxExec, sanitize: d.sanitize, ...(d.captureLines !== undefined ? { captureLines: d.captureLines } : {}) },
      paneId,
    );
  }

  // --- read accessors ---

  /** null = cold start (no published snapshot yet → route returns 503). */
  getSnapshot(): SnapshotResponse | null {
    if (this.published === null) return null;
    return {
      snapshotVersion: this.version,
      runtimeEpoch: this.opts.runtimeEpoch,
      emittedAt: this.opts.now().toISOString(),
      data: this.published,
      recentActivity: this.activityLog.tail(ACTIVITY_BOOTSTRAP_TAIL),
    };
  }

  getCamp(campId: string): Camp | null {
    if (this.published === null) return null;
    return this.published.camps.find((c) => c.id === campId) ?? null;
  }

  getHealth(): HealthResponse {
    return {
      status: 'ok',
      schemaVersion: 1,
      snapshotVersion: this.version,
      runtimeEpoch: this.opts.runtimeEpoch,
      scannerRunning: !this.stopped,
      lastScanAt: this.lastScanAt,
      lastScanOk: this.lastScanOk,
      stale: this.published?.stale ?? false,
      tmux: {
        installed: this.published?.tmux.installed ?? false,
        serverRunning: this.published?.tmux.serverRunning ?? false,
      },
      uptimeMs: Math.max(0, this.opts.now().getTime() - this.startedAtMs),
    };
  }

  /** undefined = orc not in current snapshot (route → 404). */
  getOrcPreview(orcId: string): OrcPreviewResponse | undefined {
    if (this.published === null) return undefined;
    const orc = this.published.camps.flatMap((c) => c.orcs).find((o) => o.id === orcId);
    if (!orc) return undefined;

    const base = {
      snapshotVersion: this.version,
      runtimeEpoch: this.opts.runtimeEpoch,
      emittedAt: this.opts.now().toISOString(),
      orcId,
    };
    if (orc.preview === null) return { ...base, preview: null };

    const eff = this.opts.settings.effective();
    const exposureEnabled = eff.preview.exposureEnabled;
    const lineCount = Math.min(eff.preview.lineCount, PREVIEW_LINES);
    const preview: NonNullable<OrcPreviewResponse['preview']> = {
      lines: orc.preview.lines,
      truncated: orc.preview.truncated,
      redacted: orc.preview.redacted,
      exposureEnabled,
    };
    if (exposureEnabled) {
      const tail = this.runner.captureTailFor(orc.paneId) ?? [];
      preview.text = tail.slice(-lineCount); // already redacted; never raw
    }
    return { ...base, preview };
  }
}
