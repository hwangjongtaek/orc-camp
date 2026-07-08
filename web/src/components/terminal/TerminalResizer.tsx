/**
 * SPEC-203 §2.4 — terminal viewport resize handle. A horizontal separator between the viewport and
 * the status bar; dragging it (or Arrow/Home/End when focused) changes the persisted viewport
 * height (store `ui.terminalViewportHeight`). The observing viewport used to be a fixed, too-short
 * box — this lets the user give the terminal as much room as they want.
 *
 * Accessible: `role="separator"` + `aria-orientation="horizontal"` + aria-value* so assistive tech
 * and keyboard users can resize without a pointer (color-independent, keyboard-complete).
 */
import { useCallback, useRef } from 'react';
import { TERMINAL_HEIGHT_MAX, TERMINAL_HEIGHT_MIN } from '../../store/store';

const KEY_STEP = 24; // px per Arrow press

export interface TerminalResizerProps {
  height: number;
  onResize: (height: number) => void;
}

export function TerminalResizer({ height, onResize }: TerminalResizerProps): JSX.Element {
  // Drag origin captured on pointer-down so movement is relative to the grab point, not absolute.
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      dragRef.current = { startY: e.clientY, startH: height };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const d = dragRef.current;
      if (!d) return;
      onResize(d.startH + (e.clientY - d.startY)); // drag down = taller (clamp is in the store)
    },
    [onResize],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      let next: number | null = null;
      if (e.key === 'ArrowDown') next = height + KEY_STEP;
      else if (e.key === 'ArrowUp') next = height - KEY_STEP;
      else if (e.key === 'Home') next = TERMINAL_HEIGHT_MIN;
      else if (e.key === 'End') next = TERMINAL_HEIGHT_MAX;
      if (next === null) return;
      e.preventDefault();
      onResize(next);
    },
    [height, onResize],
  );

  return (
    <div
      className="oc-term__resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal — drag, or Arrow / Home / End keys"
      aria-valuenow={height}
      aria-valuemin={TERMINAL_HEIGHT_MIN}
      aria-valuemax={TERMINAL_HEIGHT_MAX}
      tabIndex={0}
      data-testid="terminal-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <span className="oc-term__resize-grip" aria-hidden="true" />
    </div>
  );
}
