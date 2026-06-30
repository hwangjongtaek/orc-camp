/**
 * Scan runner — owns the cross-cycle execution lifecycle (SPEC-001 §3.1).
 *
 * A single `scanOnce()` collects a read-only tmux inventory, applies the redaction
 * chokepoint (via injected deps), and assembles a ScanResult. The runner holds the
 * state that only matters across cycles / `--watch` (SPEC-002 §2.7, SPEC-004 §3.7):
 *  - last-good inventory for stale fallback (R-TMUX-005),
 *  - prior capture fingerprints + statuses passed to inference (active/waiting),
 *  - short retention of disappeared orcs as `terminated` (S-GONE, R-ORC-006).
 *
 * On a single-shot run (one `scanOnce`), priors are empty, so change-based `active`
 * and disappearance-based `terminated` are not asserted (SPEC-001-AC-09) — exactly
 * the documented single-shot degradation.
 *
 * All collaborators are injected so the whole pipeline is testable without live tmux.
 */
import {
  T_TERM_MS,
  type AgentDetector,
  type DetectOrcFn,
  type InferStatusFn,
  type ProcessSnapshotFn,
  type InventoryResult,
  type Orc,
  type PriorOrcState,
  type ProcessSpawn,
  type RedactFn,
  type SanitizeFn,
  type ScanResult,
  type TmuxExecFn,
  type UsageCollectFn,
} from './types';
import { collectInventory } from './tmux/inventory';
import { assembleScanResult } from './assemble';
import { tmuxExec as defaultTmuxExec, safeSpawn } from './tmux/exec';
import { makeProcessSnapshot } from './tmux/introspect';
import { redact, sanitizeCapture } from './redaction/redact';
import { detectOrc as defaultDetectOrc, defaultDetectors } from './detection/detect';
import { inferStatus as defaultInferStatus } from './status/infer';
import { makeUsageCollector } from './usage/collect';

export interface ScanRuntimeDeps {
  tmuxExec: TmuxExecFn;
  processSnapshot: ProcessSnapshotFn;
  sanitize: SanitizeFn;
  redact: RedactFn;
  detectOrc: DetectOrcFn;
  inferStatus: InferStatusFn;
  detectors: AgentDetector[];
  /** SPEC-008 best-effort usage collector (read-only, bounded, per-orc isolated). */
  collectUsage: UsageCollectFn;
  now: () => Date;
  timeoutMs?: number;
  captureLines?: number;
}

/** Wire the real implementations (used by the CLI; tests inject fakes). */
export function createDefaultDeps(spawn: ProcessSpawn = safeSpawn): ScanRuntimeDeps {
  return {
    tmuxExec: defaultTmuxExec,
    processSnapshot: makeProcessSnapshot(spawn),
    sanitize: sanitizeCapture,
    redact,
    detectOrc: defaultDetectOrc,
    inferStatus: defaultInferStatus,
    detectors: defaultDetectors,
    // Build the usage collector with the SAME hardened spawn as `ps`, so the SPEC-008 §4.2a
    // open-handle (lsof) locator inherits shell:false + fixed argv + timeout (G9).
    collectUsage: makeUsageCollector({ spawn }),
    now: () => new Date(),
  };
}

function terminatedClone(orc: Orc): Orc {
  return {
    ...orc,
    status: 'terminated',
    statusConfidence: 0.9,
    statusSignals: [
      { signal: 'lifecycle', status: 'terminated', strength: 'A', ruleId: 'terminated/gone' },
    ],
  };
}

export class ScanRunner {
  private lastGood: InventoryResult | null = null;
  private lastGoodAt: string | null = null; // scannedAt of the cycle that produced lastGood
  private priors = new Map<string, PriorOrcState>();
  private lastOrcsByPaneId = new Map<string, Orc>();
  private retained = new Map<string, { orc: Orc; firstMs: number }>();
  /** Per-orc redacted capture tail from the latest published cycle (SPEC-101 §2.11 preview). */
  private lastCaptures = new Map<string, string[]>();

  constructor(private readonly deps: ScanRuntimeDeps) {}

  async scanOnce(): Promise<ScanResult> {
    const startDate = this.deps.now();
    const start = startDate.getTime();
    const scannedAt = startDate.toISOString();

    const fresh = await collectInventory({
      tmuxExec: this.deps.tmuxExec,
      processSnapshot: this.deps.processSnapshot,
      sanitize: this.deps.sanitize,
      redact: this.deps.redact,
      now: this.deps.now,
      ...(this.deps.timeoutMs !== undefined ? { timeoutMs: this.deps.timeoutMs } : {}),
      ...(this.deps.captureLines !== undefined ? { captureLines: this.deps.captureLines } : {}),
    });

    let inventory: InventoryResult;
    let stale: boolean;
    let lastGoodAt: string | null;

    if (fresh.collectedOk) {
      // Fresh: lastGoodAt == scannedAt (SPEC-005 §3.1-2). Remember it for future
      // stale fallbacks (it is the time this inventory was actually collected).
      this.lastGood = fresh;
      this.lastGoodAt = scannedAt;
      inventory = fresh;
      stale = false;
      lastGoodAt = scannedAt;
    } else if (this.lastGood) {
      // Stale fallback: serve last-good content but carry the current errors. Status
      // inference receives snapshotStale=true → each orc resolves to `stale`.
      inventory = { ...this.lastGood, errors: fresh.errors };
      stale = true;
      lastGoodAt = this.lastGoodAt;
    } else {
      // First failure with no last-good: emit an empty inventory (camps=[], SPEC-005
      // AC-07) — do NOT fabricate stale data. Availability + errors are preserved for
      // diagnostics even if list-sessions happened to succeed before list-panes failed.
      inventory = { ...fresh, sessions: [], panes: [] };
      stale = false;
      lastGoodAt = null;
    }

    const retainedTerminated = this.reconcileRetained(inventory, stale);
    const scanDurationMs = Math.max(0, this.deps.now().getTime() - start);

    const { result, nextPriors, liveOrcsByPaneId } = await assembleScanResult({
      inventory,
      scannedAt,
      stale,
      lastGoodAt,
      scanDurationMs,
      detectOrc: this.deps.detectOrc,
      inferStatus: this.deps.inferStatus,
      detectors: this.deps.detectors,
      collectUsage: this.deps.collectUsage,
      priors: this.priors,
      retainedTerminated,
    });

    if (!stale) {
      this.priors = nextPriors;
      this.lastOrcsByPaneId = liveOrcsByPaneId;
    }

    // Retain the redacted capture tail per orc for the lazy preview endpoint.
    const paneById = new Map(inventory.panes.map((p) => [p.paneId, p]));
    const captures = new Map<string, string[]>();
    for (const camp of result.camps) {
      for (const orc of camp.orcs) {
        const pane = paneById.get(orc.paneId);
        captures.set(orc.paneId, pane?.capture ? pane.capture.lines : []);
      }
    }
    this.lastCaptures = captures;

    return result;
  }

  /** Redacted capture tail (oldest→newest) for an orc paneId, or null if none retained. */
  captureTailFor(paneId: string): string[] | null {
    return this.lastCaptures.get(paneId) ?? null;
  }

  /** S-GONE retention (SPEC-004 §3.7): emit disappeared orcs as `terminated` for T_term. */
  private reconcileRetained(inventory: InventoryResult, stale: boolean): Orc[] {
    const nowMs = this.deps.now().getTime();
    const livePaneIds = new Set(inventory.panes.map((p) => p.paneId));
    const liveSessionNames = new Set(inventory.sessions.map((s) => s.sessionName));

    if (!stale) {
      // Newly-disappeared orcs (present last cycle, absent now) → start retention.
      for (const [paneId, orc] of this.lastOrcsByPaneId) {
        if (!livePaneIds.has(paneId) && !this.retained.has(paneId)) {
          this.retained.set(paneId, { orc: terminatedClone(orc), firstMs: nowMs });
        }
      }
    }
    // Drop retention if the pane reappeared.
    for (const paneId of [...this.retained.keys()]) {
      if (livePaneIds.has(paneId)) this.retained.delete(paneId);
    }
    // Expire retention past the grace window.
    for (const [paneId, entry] of [...this.retained]) {
      if (nowMs - entry.firstMs > T_TERM_MS) this.retained.delete(paneId);
    }
    // Only fold retained orcs whose session still exists.
    const out: Orc[] = [];
    for (const entry of this.retained.values()) {
      if (liveSessionNames.has(entry.orc.sessionName)) out.push(entry.orc);
    }
    return out;
  }
}
