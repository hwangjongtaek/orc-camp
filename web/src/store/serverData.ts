/**
 * SPEC-200 §2.4 — normalized SERVER state container.
 *
 * camps/orcs are normalized into stable-id Maps so a single delta merges in O(1) and
 * narrow per-id selectors isolate re-renders (SPEC-200 §3.5). `camp.orcs` is flattened
 * into `orcIdsByCamp` (ordered) + `orcsById`. Authority key is camp.id/orc.id (D-017);
 * tmuxTarget/tmuxSessionName are display-only and never used as keys.
 */
import type {
  Camp,
  Diagnostics,
  Orc,
  ScanResult,
  StatusSummary,
  TmuxAvailability,
} from '../types/domain';
import { EMPTY_STATUS_SUMMARY } from '../types/domain';

/** Camp without its inline orcs (orcs are normalized out). */
export type CampMeta = Omit<Camp, 'orcs'>;

export interface ServerData {
  schemaVersion: 1;
  snapshotVersion: number; // = lastVersionApplied (Vlast). 0 = un-bootstrapped
  scannedAt: string | null;
  stale: boolean;
  lastGoodAt: string | null;
  tmux: TmuxAvailability;
  statusSummary: StatusSummary;
  diagnostics: Diagnostics;
  campIds: string[]; // render order (tmuxSessionName asc)
  campsById: Record<string, CampMeta>;
  orcIdsByCamp: Record<string, string[]>; // ordered (windowIndex, paneIndex)
  orcsById: Record<string, Orc>;
}

export function emptyServerData(): ServerData {
  return {
    schemaVersion: 1,
    snapshotVersion: 0,
    scannedAt: null,
    stale: false,
    lastGoodAt: null,
    tmux: { installed: false, serverRunning: false, version: null },
    statusSummary: { ...EMPTY_STATUS_SUMMARY },
    diagnostics: { tmuxErrors: [], scanDurationMs: 0 },
    campIds: [],
    campsById: {},
    orcIdsByCamp: {},
    orcsById: {},
  };
}

export function campMeta(camp: Camp): CampMeta {
  const { orcs: _orcs, ...meta } = camp;
  void _orcs;
  return meta;
}

export function sortCampIds(campsById: Record<string, CampMeta>, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const na = campsById[a]?.tmuxSessionName ?? a;
    const nb = campsById[b]?.tmuxSessionName ?? b;
    return na < nb ? -1 : na > nb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
}

export function sortOrcIds(orcsById: Record<string, Orc>, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const oa = orcsById[a];
    const ob = orcsById[b];
    if (!oa || !ob) return 0;
    if (oa.windowIndex !== ob.windowIndex) return oa.windowIndex - ob.windowIndex;
    if (oa.paneIndex !== ob.paneIndex) return oa.paneIndex - ob.paneIndex;
    return oa.id < ob.id ? -1 : oa.id > ob.id ? 1 : 0;
  });
}

/** Build normalized server data from a full REST snapshot (SPEC-200 §2.5 applySnapshot). */
export function fromSnapshot(data: ScanResult, snapshotVersion: number): ServerData {
  const campsById: Record<string, CampMeta> = {};
  const orcIdsByCamp: Record<string, string[]> = {};
  const orcsById: Record<string, Orc> = {};

  for (const camp of data.camps) {
    campsById[camp.id] = campMeta(camp);
    const orcIds: string[] = [];
    for (const orc of camp.orcs) {
      orcsById[orc.id] = orc;
      orcIds.push(orc.id);
    }
    orcIdsByCamp[camp.id] = sortOrcIds(orcsById, orcIds);
  }

  const campIds = sortCampIds(
    campsById,
    data.camps.map((c) => c.id),
  );

  return {
    schemaVersion: 1,
    snapshotVersion,
    scannedAt: data.scannedAt,
    stale: data.stale,
    lastGoodAt: data.lastGoodAt,
    tmux: data.tmux,
    statusSummary: data.statusSummary,
    diagnostics: data.diagnostics,
    campIds,
    campsById,
    orcIdsByCamp,
    orcsById,
  };
}

/** Reconstruct a full Camp (meta + ordered orcs) for camp-detail consumers. */
export function selectCamp(server: ServerData, campId: string): Camp | null {
  const meta = server.campsById[campId];
  if (!meta) return null;
  const orcIds = server.orcIdsByCamp[campId] ?? [];
  const orcs = orcIds
    .map((id) => server.orcsById[id])
    .filter((o): o is Orc => o !== undefined);
  return { ...meta, orcs };
}
