/** SPEC-203 §2.4 — subscribe to the shared live pane-view controller (SPEC-103 channel). */
import { useSyncExternalStore } from 'react';
import { useServices } from '../../app/services';
import type { LiveViewSnapshot } from '../../realtime/liveView';

export function useLiveView(): LiveViewSnapshot {
  const { engine } = useServices();
  return useSyncExternalStore(engine.liveView.subscribe, engine.liveView.getSnapshot);
}
