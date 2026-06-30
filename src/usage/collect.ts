/**
 * SPEC-008 — usage collector orchestrator. Builds the injected {@link UsageCollectFn} that the
 * assemble pipeline calls once per orc. It selects a provider by `agentType`, constructs a
 * ConfinedReader bound to that provider's CODE-FIXED root, runs the provider, and emits an
 * optional METADATA-ONLY debug record. It NEVER throws: any provider/reader error degrades to
 * `null`, so one orc's failure can never abort the scan (G6/AC-10, per-orc isolation).
 *
 * Roots are fixed (not user-supplied, PF-U02) but injectable for tests (so the suite never
 * depends on a live ~/.claude). The debug sink defaults to a no-op — by default the collector
 * logs NOTHING, and when a sink is provided it receives only phase/provider/paneId/durationMs/
 * bytesRead/lineCount/outcome (no transcript text, no secret, no session path — AC-03/§4.5).
 */
import type {
  AgentType,
  OrcUsage,
  ProcessSpawn,
  UsageCollectFn,
  UsageLocateHint,
} from '../types';
import { safeSpawn } from '../tmux/exec';
import { makeConfinedReader } from './reader';
import type { UsageProvider } from './provider';
import { makeOpenHandleLocator, type OpenHandleLocator } from './openhandle';
import { makeClaudeCodeProvider, defaultClaudeRoot } from './providers/claude-code';
import { makeCodexProvider, defaultCodexRoot } from './providers/codex';

/** Metadata-only debug record (§4.5). No path/content/secret may ever appear here. */
export interface UsageDebugEntry {
  phase: 'usage';
  provider: string; // provider id, or 'none' when no provider matched
  paneId: string; // authoritative identity (structural, not content)
  durationMs: number;
  bytesRead: number;
  lineCount: number;
  outcome: 'ok' | 'null' | 'error';
}

export interface UsageCollectorOptions {
  /** Override the provider registry (tests). Default: claude-code + codex(stub). */
  providers?: Map<AgentType, UsageProvider>;
  /** Override fixed roots (tests point these at temp dirs; never user-supplied at runtime). */
  roots?: { claudeProjects?: string; codexSessions?: string };
  /** Current-uid provider (tests inject a mismatch to exercise ownership refusal). */
  getUid?: () => number;
  /** Monotonic clock (ms) for the per-file time budget (tests). */
  now?: () => number;
  /** Reader bound overrides (tests shrink caps to exercise bounded read). */
  readerOptions?: { maxBytes?: number; maxLines?: number; maxLineBytes?: number; timeBudgetMs?: number };
  /** Metadata-only debug sink. Default: no-op (collector logs nothing). */
  onDebug?: (entry: UsageDebugEntry) => void;
  /**
   * Hardened spawn primitive for the open-handle (lsof) locator. Defaults to the SAME `safeSpawn`
   * used by `ps` (shell:false, fixed argv, timeout). Provided by scan.ts so both surfaces share it.
   */
  spawn?: ProcessSpawn;
  /** Override the open-handle (fd) locator directly (tests inject a deterministic mock). */
  openHandle?: OpenHandleLocator;
}

export function makeUsageCollector(opts: UsageCollectorOptions = {}): UsageCollectFn {
  const claudeRoot = opts.roots?.claudeProjects ?? defaultClaudeRoot();
  const codexRoot = opts.roots?.codexSessions ?? defaultCodexRoot();

  const providers =
    opts.providers ??
    new Map<AgentType, UsageProvider>([
      ['claude-code', makeClaudeCodeProvider(claudeRoot)],
      ['codex', makeCodexProvider(codexRoot)],
      // 'unknown' intentionally absent → generic fallback → null (G8).
    ]);

  const now = opts.now ?? (() => Date.now());
  const onDebug = opts.onDebug;
  // SPEC-008 §4.2a — open-handle (fd) locator. Defaults to the real lsof/`/proc` locator over the
  // shared safeSpawn; tests inject a mock locator (or a mock spawn) so NO live lsof ever runs.
  const openHandle = opts.openHandle ?? makeOpenHandleLocator(opts.spawn ?? safeSpawn);

  return async (hint: UsageLocateHint): Promise<OrcUsage | null> => {
    const start = now();
    let provider: UsageProvider | undefined;
    let outcome: UsageDebugEntry['outcome'] = 'null';
    let bytesRead = 0;
    let lineCount = 0;
    try {
      provider = providers.get(hint.agentType);
      if (!provider) {
        return null; // unknown / unmapped agent → null (generic fallback)
      }
      const reader = makeConfinedReader({
        root: provider.root,
        ...(opts.getUid ? { getUid: opts.getUid } : {}),
        now,
        ...(opts.readerOptions ?? {}),
      });
      // SPEC-008 §4.2a — pre-resolve the pane's in-root `.jsonl` open handles (async lsof/`/proc`).
      // Bounded, read-only, and NEVER aborts collection: any failure degrades to [] (G6/G9).
      let handlePaths: string[] = [];
      if (reader.rootReal) {
        try {
          handlePaths = await openHandle(hint.agentPids, reader.rootReal);
        } catch {
          handlePaths = [];
        }
      }
      const usage = provider.collect(hint, reader, handlePaths);
      const stats = reader.lastStats;
      if (stats) {
        bytesRead = stats.bytesRead;
        lineCount = stats.lineCount;
      }
      outcome = usage ? 'ok' : 'null';
      return usage;
    } catch {
      outcome = 'error'; // NEVER propagates — collection failure is this orc's null (AC-10)
      return null;
    } finally {
      if (onDebug) {
        onDebug({
          phase: 'usage',
          provider: provider?.id ?? 'none',
          paneId: hint.paneId,
          durationMs: Math.max(0, now() - start),
          bytesRead,
          lineCount,
          outcome,
        });
      }
    }
  };
}

/** Default production collector: fixed roots, real uid, no debug logging. */
export const defaultUsageCollector: UsageCollectFn = makeUsageCollector();
