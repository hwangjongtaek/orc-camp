/**
 * SPEC-101 §2.1–2.3 — snapshot runtime (serve-mode scan loop).
 *
 * Wraps the PoC ScanRunner: scans on an interval (single in-flight, coalesced),
 * bumps snapshotVersion only on a content change (diff), keeps the last published
 * snapshot + liveness + a small recent-activity tail in memory. All read accessors
 * serve the current published snapshot; preview text is gated (token by the route,
 * exposure here).
 */
import { PREVIEW_LINES, type Camp, type ScanResult } from '../types';
import { ScanRunner, type ScanRuntimeDeps } from '../scan';
import { diffSnapshots, snapshotChanged, type DiffEvent } from './diff';
import type { ActivityEvent, HealthResponse, OrcPreviewResponse, ServerSettings, SnapshotResponse } from './types';

/** SPEC-102 runtime → WS frames (envelope added by the WS layer). */
export type RuntimeEvent =
  | { type: 'batch'; version: number; changes: DiffEvent[] }
  | { type: 'server_stale_changed'; stale: boolean; lastGoodAt: string | null; version: number };

export const ACTIVITY_BOOTSTRAP_TAIL = 50;
const ACTIVITY_RING_MAX = 200;

export interface RuntimeOptions {
  deps: ScanRuntimeDeps;
  settings: ServerSettings;
  runtimeEpoch: string;
  now: () => Date;
}

export class SnapshotRuntime {
  private runner: ScanRunner;
  private published: ScanResult | null = null;
  private version = 0;
  private lastScanAt: string | null = null;
  private lastScanOk = false;
  private activity: ActivityEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private scanning: Promise<ScanResult | null> | null = null;
  private startedAtMs: number;
  private startedAtIso: string;
  private seq = 0;
  private listeners = new Set<(e: RuntimeEvent) => void>();

  constructor(private readonly opts: RuntimeOptions) {
    this.runner = new ScanRunner(opts.deps);
    const d = opts.now();
    this.startedAtMs = d.getTime();
    this.startedAtIso = d.toISOString();
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
    await this.runScan();
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runScan().finally(() => this.schedule());
    }, this.opts.settings.scanIntervalS * 1000);
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
      next.stale ||
      next.diagnostics.tmuxErrors.some((e) => e.phase === 'inventory' || e.phase === 'probe');
    this.lastScanOk = !inventoryFailed;
    this.pushActivity(this.lastScanOk ? 'scan.ok' : 'scan.fail', this.lastScanOk ? 'scan completed' : 'scan degraded (stale/inventory error)');
    const prior = this.published;
    if (snapshotChanged(prior, next)) {
      const changes = diffSnapshots(prior, next);
      this.published = next;
      this.version += 1;
      this.pushActivity('snapshot.update', `snapshot v${this.version}`);
      if (changes.length > 0) this.emit({ type: 'batch', version: this.version, changes });
      if ((prior?.stale ?? false) !== next.stale) {
        this.emit({ type: 'server_stale_changed', stale: next.stale, lastGoodAt: next.lastGoodAt, version: this.version });
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
    this.activity = [];
  }

  private nextId(): string {
    this.seq += 1;
    return `${this.opts.runtimeEpoch}.${this.seq}`;
  }
  private pushActivity(type: string, message: string): void {
    this.activity.push({ id: this.nextId(), at: this.opts.now().toISOString(), type, message });
    if (this.activity.length > ACTIVITY_RING_MAX) this.activity.splice(0, this.activity.length - ACTIVITY_RING_MAX);
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
      recentActivity: this.activity.slice(-ACTIVITY_BOOTSTRAP_TAIL),
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

    const exposureEnabled = this.opts.settings.preview.exposureEnabled;
    const lineCount = Math.min(this.opts.settings.preview.lineCount, PREVIEW_LINES);
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
