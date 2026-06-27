/**
 * SPEC-400 §2.11 — result toasts (success=info / aborted=warn / failed=error).
 * aria-live so screen readers announce control outcomes; auto-dismiss + manual close.
 */
import { useEffect } from 'react';
import { useStore, type Toast } from '../../store/store';

const AUTO_DISMISS_MS = 6000;

export function Toasts(): JSX.Element | null {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="oc-toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }): JSX.Element {
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    const handle = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(handle);
  }, [toast.id, dismiss]);

  return (
    <div
      className={`oc-toast oc-toast--${toast.severity}`}
      role={toast.severity === 'error' ? 'alert' : 'status'}
    >
      <span>{toast.message}</span>
      <button
        className="oc-toast__close"
        aria-label="Dismiss notification"
        onClick={() => dismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}
