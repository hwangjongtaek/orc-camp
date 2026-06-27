/**
 * SPEC-200 §2.3/§2.4 — single store, three physically-separated slices.
 *
 * server : SERVER state — only applySnapshot/applyBatch may write it (invariant ②).
 * connection : transport/bootstrap state (wsStatus, Vlast, runtimeEpoch, errors).
 * ui : CLIENT state (selection, inspector) — UI actions touch only this slice.
 *
 * Token is NOT in the store (invariant ④) — it lives in api/token.ts.
 */
import { create } from 'zustand';
import type {
  ActivityEvent,
  ClientApiError,
  SettingsResponse,
  SnapshotResponse,
} from '../types/api';
import type { DiffEvent } from '../types/ws';
import { applyChanges, decideOutcome, type ReconcileOutcome } from '../realtime/reconcile';
import {
  emptyServerData,
  fromSnapshot,
  type ServerData,
} from './serverData';
import { deriveViewState, totalOrcCount, type ViewState } from './viewStatus';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'disconnected' | 'reconnecting';
export type BootstrapPhase = 'pending' | 'ws-open' | 'snapshot-applied' | 'live';
export type RefreshState = 'idle' | 'refreshing' | 'throttled';

export interface ConnectionSlice {
  wsStatus: WsStatus;
  bootstrapPhase: BootstrapPhase;
  lastVersionApplied: number;
  runtimeEpoch: string | null;
  lastSnapshotAt: string | null;
  refreshState: RefreshState;
  lastError: ClientApiError | null;
  unauthorized: boolean;
}

export interface UiSlice {
  selectedCampId: string | null;
  selectedOrcId: string | null;
  inspectorOpen: boolean;
}

export type ToastSeverity = 'info' | 'warn' | 'error';
export interface Toast {
  id: string;
  severity: ToastSeverity;
  message: string;
}

export interface StoreState {
  server: ServerData;
  connection: ConnectionSlice;
  ui: UiSlice;
  activity: ActivityEvent[];
  settings: SettingsResponse | null;
  reducedMotion: boolean;
  toasts: Toast[];

  // --- server-state writers (reconcile only) ---
  applySnapshot: (res: SnapshotResponse) => void;
  applyBatchFrame: (version: number, changes: DiffEvent[]) => ReconcileOutcome;
  setServerStale: (stale: boolean, lastGoodAt: string | null) => void;
  resetServer: () => void;

  // --- connection writers ---
  setWsStatus: (status: WsStatus) => void;
  setBootstrapPhase: (phase: BootstrapPhase) => void;
  setRuntimeEpoch: (epoch: string | null) => void;
  setUnauthorized: (value: boolean) => void;
  setError: (error: ClientApiError | null) => void;
  setRefreshState: (state: RefreshState) => void;

  // --- ui writers (client state) ---
  setSelectedCamp: (campId: string | null) => void;
  setSelectedOrc: (orcId: string | null) => void;
  setInspectorOpen: (open: boolean) => void;

  // --- misc ---
  setSettings: (settings: SettingsResponse | null) => void;
  setReducedMotion: (value: boolean) => void;
  addToast: (severity: ToastSeverity, message: string) => string;
  dismissToast: (id: string) => void;
}

let toastSeq = 0;

const initialConnection: ConnectionSlice = {
  wsStatus: 'idle',
  bootstrapPhase: 'pending',
  lastVersionApplied: 0,
  runtimeEpoch: null,
  lastSnapshotAt: null,
  refreshState: 'idle',
  lastError: null,
  unauthorized: false,
};

const initialUi: UiSlice = {
  selectedCampId: null,
  selectedOrcId: null,
  inspectorOpen: false,
};

/** Drop the orc selection if the selected orc no longer exists (SPEC-200 §3.3). */
function reconcileSelection(server: ServerData, ui: UiSlice): UiSlice {
  if (ui.selectedOrcId !== null && !server.orcsById[ui.selectedOrcId]) {
    return { ...ui, selectedOrcId: null, inspectorOpen: false };
  }
  return ui;
}

export const useStore = create<StoreState>()((set, get) => ({
  server: emptyServerData(),
  connection: { ...initialConnection },
  ui: { ...initialUi },
  activity: [],
  settings: null,
  reducedMotion: false,
  toasts: [],

  applySnapshot: (res) => {
    set((state) => {
      const server = fromSnapshot(res.data, res.snapshotVersion);
      return {
        server,
        activity: res.recentActivity,
        ui: reconcileSelection(server, state.ui),
        connection: {
          ...state.connection,
          lastVersionApplied: res.snapshotVersion,
          runtimeEpoch: res.runtimeEpoch,
          lastSnapshotAt: res.emittedAt,
          bootstrapPhase: 'live',
          lastError:
            state.connection.lastError?.scope === 'global'
              ? null
              : state.connection.lastError,
          unauthorized: false,
        },
      };
    });
  },

  applyBatchFrame: (version, changes) => {
    const { server, connection } = get();
    const outcome = decideOutcome({
      version,
      frameEpoch: connection.runtimeEpoch ?? '',
      runtimeEpoch: connection.runtimeEpoch,
      lastVersionApplied: connection.lastVersionApplied,
    });
    if (outcome !== 'applied') return outcome;

    const result = applyChanges(server, changes, version);
    if (!result.ok) return 'resync-required';

    // Atomic single commit → one render (SPEC-200 §2.5-5).
    set((state) => ({
      server: result.next,
      ui: reconcileSelection(result.next, state.ui),
      connection: {
        ...state.connection,
        lastVersionApplied: version,
        bootstrapPhase: 'live',
      },
    }));
    return 'applied';
  },

  setServerStale: (stale, lastGoodAt) => {
    set((state) => ({ server: { ...state.server, stale, lastGoodAt } }));
  },

  resetServer: () => {
    set({ server: emptyServerData() });
  },

  setWsStatus: (wsStatus) => {
    set((state) => ({ connection: { ...state.connection, wsStatus } }));
  },
  setBootstrapPhase: (bootstrapPhase) => {
    set((state) => ({ connection: { ...state.connection, bootstrapPhase } }));
  },
  setRuntimeEpoch: (runtimeEpoch) => {
    set((state) => ({ connection: { ...state.connection, runtimeEpoch } }));
  },
  setUnauthorized: (unauthorized) => {
    set((state) => ({ connection: { ...state.connection, unauthorized } }));
  },
  setError: (lastError) => {
    set((state) => ({ connection: { ...state.connection, lastError } }));
  },
  setRefreshState: (refreshState) => {
    set((state) => ({ connection: { ...state.connection, refreshState } }));
  },

  setSelectedCamp: (selectedCampId) => {
    set((state) => ({ ui: { ...state.ui, selectedCampId } }));
  },
  setSelectedOrc: (selectedOrcId) => {
    set((state) => ({
      ui: { ...state.ui, selectedOrcId, inspectorOpen: selectedOrcId !== null },
    }));
  },
  setInspectorOpen: (inspectorOpen) => {
    set((state) => ({ ui: { ...state.ui, inspectorOpen } }));
  },

  setSettings: (settings) => set({ settings }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),

  addToast: (severity, message) => {
    const id = `t${++toastSeq}`;
    set((state) => ({ toasts: [...state.toasts, { id, severity, message }] }));
    return id;
  },
  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Derived global view-state (SPEC-200 §2.7). */
export function selectViewState(state: StoreState): ViewState {
  return deriveViewState({
    unauthorized: state.connection.unauthorized,
    hasBootstrapped:
      state.connection.bootstrapPhase === 'live' || state.server.snapshotVersion > 0,
    tmux: state.server.tmux,
    campCount: state.server.campIds.length,
    totalOrcCount: totalOrcCount(state.server.statusSummary),
    stale: state.server.stale,
    wsDisconnected:
      state.connection.wsStatus === 'disconnected' ||
      state.connection.wsStatus === 'reconnecting',
  });
}
