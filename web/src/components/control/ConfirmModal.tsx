/**
 * SPEC-202 §2.4 K5 / §2.8 A6 + SPEC-400 §2.7 — destructive confirm modal.
 *
 * - role="dialog" aria-modal; focus is trapped inside while open.
 * - initial focus on the SAFE default (Cancel); the destructive button is not auto-focused.
 * - Escape cancels; on close, focus returns to the triggering element.
 * - shows the 4 context fields (agentType/tmuxTarget/cwd/command) the action revalidates.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export interface ContextField {
  label: string;
  value: string;
}

export function ConfirmModal({
  title,
  body,
  fields,
  confirmLabel,
  confirmDisabled = false,
  className,
  children,
  fallbackFocusSelector,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  /** Context fields (interrupt variant). Omit/empty for a custom-content (broadcast) variant. */
  fields?: ContextField[];
  confirmLabel: string;
  /** Disable the confirm button (e.g. broadcast with empty input) without leaving the trap. */
  confirmDisabled?: boolean;
  /** Extra class on the dialog (e.g. `oc-modal--broadcast` for the wider list variant). */
  className?: string;
  /** Custom body content rendered between `body` and the footer (broadcast list + input). */
  children?: ReactNode;
  /**
   * Deterministic focus target if the trigger is gone on close (e.g. a toast-launched confirm whose
   * toast auto-dismissed). CSS selector for an element to focus instead of `<body>` (SPEC-203 §2.10).
   */
  fallbackFocusSelector?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useRef(`oc-modal-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus(); // initial focus on the safe default

    const focusables = (): HTMLElement[] => {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus to the trigger; if it's gone/lost (an auto-dismissed toast leaves focus on
      // <body>), fall back to a deterministic element so focus never silently vanishes (§2.10, AC-18 v).
      const triggerUsable = trigger && trigger.isConnected && trigger !== document.body;
      if (triggerUsable) {
        trigger.focus?.();
      } else if (fallbackFocusSelector) {
        document.querySelector<HTMLElement>(fallbackFocusSelector)?.focus();
      }
    };
  }, [onCancel, fallbackFocusSelector]);

  return (
    <div className="oc-modal__backdrop" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className={'oc-modal' + (className ? ' ' + className : '')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {body && <p className="oc-muted">{body}</p>}
        {fields && fields.length > 0 && (
          <dl className="oc-modal__fields">
            {fields.map((f) => (
              <div key={f.label} className="oc-modal__field">
                <dt className="oc-field__label">{f.label}</dt>
                <dd className="oc-field__value oc-field__value--mono">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
        <div className="oc-modal__actions">
          <button ref={cancelRef} className="oc-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="oc-btn oc-btn--danger"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
