/**
 * SPEC-201 §3.8 (#45) — bottom-sheet focus trap + dismissal.
 *
 * The sheet is a modal dialog: initial focus moves inside, Tab/Shift+Tab cycle within, Escape
 * + close button + backdrop dismiss, and focus is restored to the opener on unmount.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { BottomSheet } from '../src/components/inspector/BottomSheet';

function renderSheet(onClose = vi.fn()) {
  const r = render(
    <BottomSheet title="Orc inspector" onClose={onClose}>
      <button type="button">First</button>
      <button type="button">Last</button>
    </BottomSheet>,
  );
  return { ...r, onClose };
}

describe('SPEC-201 §3.8 #45 BottomSheet', () => {
  it('is a labelled dialog with focus moved to the close button on open', () => {
    const { getByRole, getByLabelText } = renderSheet();
    const dialog = getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Orc inspector');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(getByLabelText('Close inspector'));
  });

  it('Escape, the close button, and the backdrop all dismiss; clicking the sheet does not', () => {
    // Escape
    const a = renderSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(a.onClose).toHaveBeenCalledTimes(1);
    a.unmount();

    // close button
    const b = renderSheet();
    fireEvent.click(b.getByLabelText('Close inspector'));
    expect(b.onClose).toHaveBeenCalledTimes(1);
    b.unmount();

    // backdrop vs. sheet body
    const c = renderSheet();
    fireEvent.mouseDown(c.getByTestId('inspector-sheet')); // inside → stays open
    expect(c.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(c.getByTestId('inspector-sheet-backdrop')); // backdrop → dismiss
    expect(c.onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab within the sheet (wraps last→first and first→last)', () => {
    const { getByLabelText, getByText } = renderSheet();
    const close = getByLabelText('Close inspector');
    const last = getByText('Last');

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close); // last → wraps to first

    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last); // first (shift) → wraps to last
  });

  it('renders arbitrary children (controls stay reachable)', () => {
    const { getByTestId } = renderSheet();
    const sheet = getByTestId('inspector-sheet');
    expect(within(sheet).getByText('First')).toBeTruthy();
    expect(within(sheet).getByText('Last')).toBeTruthy();
  });
});
