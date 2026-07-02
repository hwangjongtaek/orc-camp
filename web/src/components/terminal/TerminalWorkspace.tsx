/**
 * SPEC-203 — Terminal Workspace (terminal mode body). Composes the 5 regions below the camp header:
 * Orc Rail | (Terminal Viewport / status bar / composed input) + a shortcut legend. Owns:
 *  - live-view lifecycle wiring (attach/detach via the shared controller; exposure/tab gating);
 *  - orc switching (S1 rail, S2 [ ], S3 Alt+1-9, S4 ⌘/Ctrl+K quick switcher) — all → ?orc= (①);
 *  - Observe/Control mode + armed key routing (SPEC-401): literal bursts, named-key egress, the
 *    C-c → interrupt-confirm route, blocked destructive chords, and the dedicated disarm key;
 *  - the interrupt confirm modal (destructive gate preserved; passthrough can't bypass it).
 *
 * Selection is consumed from `?orc=` (never minted here). All egress requires an arm session
 * (Observe = no egress). Keyboard trap exists ONLY in Control mode (viewport); Observe-mode
 * shortcuts run on a document handler that ignores editable targets.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { useStore } from '../../store/store';
import { useAssets } from '../../assets/AssetContext';
import { hasToken } from '../../api/token';
import { characterKeyMap } from '../../assets/spriteResolver';
import { classifyControl } from '../../api/control';
import {
  createLiteralBatcher,
  routeKey,
  type KeyRoute,
  type LiteralBatcher,
} from '../../terminal/passthrough';
import { digitJump, nextOrc, prevOrc, railOrder, type SwitchableItem } from '../../terminal/switching';
import type { ApiResult } from '../../api/client';
import type { ControlResultBody, ExpectedTarget } from '../../types/api';
import { AGENT_LABEL } from '../status/statusMeta';
import { ConfirmModal } from '../control/ConfirmModal';
import { OrcRail } from './OrcRail';
import { TerminalViewport } from './TerminalViewport';
import { TerminalStatusBar } from './TerminalStatusBar';
import { ComposedInput } from './ComposedInput';
import { QuickSwitcher } from './QuickSwitcher';
import { ShortcutLegend } from './ShortcutLegend';
import { useLiveView } from './useLiveView';
import { useControlMode } from './useControlMode';

export interface TerminalWorkspaceProps {
  campId: string;
  selectedOrcId: string | null;
  onSelectOrc: (orcId: string) => void;
}

function isEditable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

export function TerminalWorkspace({
  campId,
  selectedOrcId,
  onSelectOrc,
}: TerminalWorkspaceProps): JSX.Element {
  const { api, engine } = useServices();
  const { manifest } = useAssets();
  const lv = engine.liveView;

  const campOrderedIds = useStore((s) => s.server.orcIdsByCamp[campId] ?? EMPTY);
  const orcsById = useStore((s) => s.server.orcsById);
  const exposureEnabled = useStore((s) => s.settings?.preview.exposureEnabled ?? false);
  const wsStatus = useStore((s) => s.connection.wsStatus);
  const addToast = useStore((s) => s.addToast);

  const connected = wsStatus === 'open';
  const orc = selectedOrcId ? orcsById[selectedOrcId] : undefined;

  // Rail order (waiting pinned) — SSOT for prev/next/digit. Portrait identity uses camp order.
  const orderedIds = useMemo(
    () => railOrder(campOrderedIds, (id) => orcsById[id]?.status === 'waiting'),
    [campOrderedIds, orcsById],
  );
  const charKeyById = useMemo(() => characterKeyMap([...campOrderedIds], manifest), [campOrderedIds, manifest]);

  const live = useLiveView();
  const controllable = !!orc && orc.status !== 'terminated' && orc.status !== 'stale';
  const [control, actions] = useControlMode(orc, { exposureEnabled, connected, controllable });

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [interruptOpen, setInterruptOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // --- live-view lifecycle ---------------------------------------------------
  useEffect(() => {
    lv.setExposure(exposureEnabled);
  }, [lv, exposureEnabled]);
  useEffect(() => {
    const sync = (): void => lv.setTabVisible(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [lv]);
  useEffect(() => {
    lv.setDesired(selectedOrcId);
  }, [lv, selectedOrcId]);
  useEffect(() => () => lv.setDesired(null), [lv]); // leaving terminal mode → detach

  // latency/countdown clock
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // --- egress (armed) --------------------------------------------------------
  const expected: ExpectedTarget | null = orc
    ? { paneId: orc.paneId, tmuxTarget: orc.tmuxTarget, command: orc.command, agentType: orc.agentType }
    : null;
  const armSessionId = control.armSessionId;
  const batcherRef = useRef<LiteralBatcher | null>(null);

  const handleEgressResult = useCallback(
    (res: ApiResult<ControlResultBody>): void => {
      if (res.ok) return;
      const fb = classifyControl(res);
      addToast(fb.severity, fb.message);
      if (fb.shouldRefresh) void engine.refresh();
      if (res.error.code === 'not_armed' || res.error.code === 'exposure_off') actions.disarm();
    },
    [addToast, engine, actions],
  );

  useEffect(() => {
    batcherRef.current?.dispose();
    if (armSessionId && orc && expected) {
      const orcId = orc.id;
      const exp = expected;
      batcherRef.current = createLiteralBatcher((text) => {
        void api
          .sendInput(orcId, { text, submit: false, expected: exp, passthrough: { armSessionId } })
          .then(handleEgressResult);
      });
    } else {
      batcherRef.current = null;
    }
    return () => batcherRef.current?.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armSessionId, orc?.id]);

  const onViewportKey = useCallback(
    (route: KeyRoute): void => {
      switch (route.kind) {
        case 'disarm':
          actions.disarm('user');
          break;
        case 'quick-switch':
          setSwitcherOpen(true);
          break;
        case 'digit-jump': {
          const id = digitJump(orderedIds, route.n);
          if (id) onSelectOrc(id);
          break;
        }
        case 'interrupt':
          setInterruptOpen(true);
          break;
        case 'blocked':
          addToast('warn', `${route.chord} is blocked in passthrough (use Interrupt for C-c).`);
          break;
        case 'key':
          if (!orc || !expected || !armSessionId) break;
          actions.notifyKeystroke();
          batcherRef.current?.flush(); // preserve ordering vs pending literals
          void api
            .sendKey(orc.id, { key: route.key, expected, passthrough: { armSessionId } })
            .then(handleEgressResult);
          break;
        case 'literal':
          actions.notifyKeystroke();
          batcherRef.current?.push(route.text);
          break;
        default:
          break;
      }
    },
    [actions, orderedIds, onSelectOrc, addToast, orc, expected, armSessionId, api, handleEgressResult],
  );

  // --- observe-mode document shortcuts (Control mode traps in the viewport) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ev = { key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey };
      const editable = isEditable(e.target);
      const route = routeKey(ev, { armed: false });
      // Always-on, non-printable combos (work even from a text field).
      if (route.kind === 'quick-switch') {
        e.preventDefault();
        setSwitcherOpen(true);
        return;
      }
      if (route.kind === 'disarm') {
        e.preventDefault();
        actions.disarm('user');
        return;
      }
      if (route.kind === 'digit-jump') {
        e.preventDefault();
        const id = digitJump(orderedIds, route.n);
        if (id) onSelectOrc(id);
        return;
      }
      // Plain [ / ] rail nav — only when not typing and not armed.
      if (editable || control.mode === 'control') return;
      if (route.kind === 'prev') {
        e.preventDefault();
        const id = prevOrc(orderedIds, selectedOrcId);
        if (id) onSelectOrc(id);
      } else if (route.kind === 'next') {
        e.preventDefault();
        const id = nextOrc(orderedIds, selectedOrcId);
        if (id) onSelectOrc(id);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [actions, orderedIds, selectedOrcId, onSelectOrc, control.mode]);

  // --- disabled predicates ---------------------------------------------------
  const disabledReason = !hasToken()
    ? 'no token'
    : !connected
      ? 'disconnected'
      : orc?.status === 'terminated'
        ? 'orc terminated'
        : orc?.status === 'stale'
          ? 'orc stale'
          : !orc
            ? 'no selection'
            : null;
  const formDisabled = disabledReason !== null;
  const armBlockedReason = !exposureEnabled ? 'preview exposure is off' : disabledReason;

  const switchItems: SwitchableItem[] = useMemo(
    () =>
      orderedIds.flatMap((id) => {
        const o = orcsById[id];
        return o
          ? [{ orcId: id, tmuxTarget: o.tmuxTarget, summaryLine: o.currentWorkSummary ?? '', status: o.status }]
          : [];
      }),
    [orderedIds, orcsById],
  );

  const onInterruptConfirm = (): void => {
    setInterruptOpen(false);
    if (!orc || !expected) return;
    void api.sendInterrupt(orc.id, { confirmed: true, expected }).then((res) => {
      const fb = classifyControl(res);
      addToast(fb.severity, fb.message);
      if (fb.shouldRefresh) void engine.refresh();
    });
  };

  return (
    <div className="oc-terminal" data-testid="terminal-workspace">
      <OrcRail
        orderedIds={orderedIds}
        orcsById={orcsById}
        charKeyById={charKeyById}
        selectedOrcId={selectedOrcId}
        onSelect={onSelectOrc}
      />
      <div className="oc-terminal__main">
        <TerminalViewport
          orcId={selectedOrcId}
          screen={live.screen}
          endReason={live.endReason}
          exposureEnabled={exposureEnabled}
          connected={connected}
          stale={live.stale}
          controlMode={control.mode}
          armWarn={control.idleWarn}
          onKey={onViewportKey}
        />
        <TerminalStatusBar
          orc={orc}
          controlMode={control.mode}
          connected={connected}
          lastFrameAt={live.lastFrameAt}
          now={now}
        />
        {orc ? (
          <ComposedInput
            orc={orc}
            disabled={formDisabled}
            disabledReason={disabledReason}
            armBlockedReason={armBlockedReason}
            control={control}
            actions={actions}
            onRequestInterrupt={() => setInterruptOpen(true)}
          />
        ) : (
          <p className="oc-muted oc-composed__none">Select an orc to type.</p>
        )}
        <ShortcutLegend />
      </div>

      {switcherOpen && (
        <QuickSwitcher
          items={switchItems}
          onSelect={onSelectOrc}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
      {interruptOpen && orc && (
        <ConfirmModal
          title="Interrupt this agent?"
          body="Sends Ctrl-C to the selected pane. This can stop the agent's current work."
          fields={[
            { label: 'agent', value: AGENT_LABEL[orc.agentType] },
            { label: 'target', value: orc.tmuxTarget },
            { label: 'cwd', value: orc.cwd },
            { label: 'command', value: orc.command },
          ]}
          confirmLabel="Interrupt"
          onConfirm={onInterruptConfirm}
          onCancel={() => setInterruptOpen(false)}
        />
      )}
    </div>
  );
}

const EMPTY: string[] = [];
