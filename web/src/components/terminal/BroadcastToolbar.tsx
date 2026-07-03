/**
 * SPEC-203 §2.10 / AC-18 (i)(vi) — broadcast selection-mode toolbar (rail header). Off-mode shows a
 * single explicit "Broadcast…" entry; on-mode shows bulk presets (Waiting / Active — current camp
 * only), a live selection count, the "Broadcast N…" trigger (opens the confirm), and Done/Clear.
 * Every control is a real button (keyboard-complete select→confirm→result flow, no mouse required).
 * Entering/leaving the mode never touches the switch selection (`?orc=`); it only owns membership.
 */
export interface BroadcastToolbarProps {
  mode: boolean;
  count: number;
  /** Whether any broadcast can be initiated (inherits the form disabled predicate, SPEC-400 §2.11). */
  disabled: boolean;
  disabledReason: string | null;
  onEnter: () => void;
  onExit: () => void;
  onBulk: (kind: 'waiting' | 'active') => void;
  onClear: () => void;
  onBroadcast: () => void;
}

export function BroadcastToolbar({
  mode,
  count,
  disabled,
  disabledReason,
  onEnter,
  onExit,
  onBulk,
  onClear,
  onBroadcast,
}: BroadcastToolbarProps): JSX.Element {
  if (!mode) {
    return (
      <div className="oc-rail__toolbar" data-testid="broadcast-toolbar">
        <button
          type="button"
          className="oc-btn oc-rail__toolbtn"
          onClick={onEnter}
          disabled={disabled}
          title={disabled ? (disabledReason ?? 'Unavailable') : 'Select multiple orcs to broadcast one input'}
          data-testid="broadcast-enter"
        >
          Broadcast…
        </button>
      </div>
    );
  }

  return (
    <div className="oc-rail__toolbar oc-rail__toolbar--active" data-testid="broadcast-toolbar" role="group" aria-label="Broadcast selection">
      <div className="oc-rail__toolrow">
        <span className="oc-field__label">Broadcast — pick targets</span>
        <button type="button" className="oc-btn oc-rail__toolbtn oc-rail__toolbtn--exit" onClick={onExit} data-testid="broadcast-exit">
          Done
        </button>
      </div>
      <div className="oc-rail__toolrow">
        <button type="button" className="oc-btn oc-rail__toolbtn" onClick={() => onBulk('waiting')} data-testid="broadcast-bulk-waiting">
          Waiting
        </button>
        <button type="button" className="oc-btn oc-rail__toolbtn" onClick={() => onBulk('active')} data-testid="broadcast-bulk-active">
          Active
        </button>
        <button type="button" className="oc-btn oc-rail__toolbtn" onClick={onClear} disabled={count === 0} data-testid="broadcast-clear">
          Clear
        </button>
      </div>
      <div className="oc-rail__toolrow">
        <span className="oc-rail__toolcount" role="status" aria-label={`${count} selected`} data-testid="broadcast-count">
          {count} selected
        </span>
        <button
          type="button"
          className="oc-btn oc-btn--primary oc-rail__toolbtn"
          onClick={onBroadcast}
          disabled={disabled || count === 0}
          title={disabled ? (disabledReason ?? 'Unavailable') : undefined}
          data-testid="broadcast-open"
        >
          Broadcast {count}…
        </button>
      </div>
      {disabled && disabledReason && (
        <p className="oc-muted" style={{ fontSize: '11px', margin: 0 }}>
          Unavailable: {disabledReason}.
        </p>
      )}
    </div>
  );
}
