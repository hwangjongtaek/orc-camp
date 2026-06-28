/**
 * SPEC-201 §3.8 (#45) — mobile bottom-sheet container.
 *
 * A slide-up dialog pinned to the bottom of the viewport. It is a proper modal surface
 * (role="dialog", aria-modal) with a focus trap (Tab/Shift+Tab cycle within the sheet),
 * Escape-to-dismiss, backdrop click-to-dismiss, an explicit close button, and focus
 * restoration to the previously focused element on unmount — mirroring the tested ConfirmModal
 * focus-trap pattern (SPEC-202 K5). Content is arbitrary children: CampDetailView renders the
 * same OrcInspector inside, so raw target/status/preview/control dock all stay reachable. The
 * slide-up uses a CSS transform; the global reduced-motion rule makes it instant (AC-11).
 * Tokens-only styling.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus(); // initial focus inside the sheet

    const focusables = (): HTMLElement[] => {
      const root = sheetRef.current;
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
        onClose();
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
      opener?.focus?.(); // restore focus to the opener
    };
  }, [onClose]);

  return (
    <div
      className="oc-sheet__backdrop"
      data-testid="inspector-sheet-backdrop"
      onMouseDown={onClose}
    >
      <div
        className="oc-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="inspector-sheet"
        ref={sheetRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="oc-sheet__handle" aria-hidden="true" />
        <div className="oc-sheet__bar">
          <h2 className="oc-sheet__title">{title}</h2>
          <button
            type="button"
            className="oc-btn oc-sheet__close"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close inspector"
          >
            ✕
          </button>
        </div>
        <div className="oc-sheet__body">{children}</div>
      </div>
    </div>
  );
}
