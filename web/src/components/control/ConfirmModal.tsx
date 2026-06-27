/**
 * SPEC-202 §2.4 K5 / §2.8 A6 + SPEC-400 §2.7 — destructive confirm modal.
 *
 * - role="dialog" aria-modal; focus is trapped inside while open.
 * - initial focus on the SAFE default (Cancel); the destructive button is not auto-focused.
 * - Escape cancels; on close, focus returns to the triggering element.
 * - shows the 4 context fields (agentType/tmuxTarget/cwd/command) the action revalidates.
 */
import { useEffect, useRef } from 'react';

export interface ContextField {
  label: string;
  value: string;
}

export function ConfirmModal({
  title,
  body,
  fields,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  fields: ContextField[];
  confirmLabel: string;
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
      trigger?.focus?.(); // restore focus to the trigger
    };
  }, [onCancel]);

  return (
    <div className="oc-modal__backdrop" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="oc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {body && <p className="oc-muted">{body}</p>}
        <dl className="oc-modal__fields">
          {fields.map((f) => (
            <div key={f.label} className="oc-modal__field">
              <dt className="oc-field__label">{f.label}</dt>
              <dd className="oc-field__value oc-field__value--mono">{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="oc-modal__actions">
          <button ref={cancelRef} className="oc-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="oc-btn oc-btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
