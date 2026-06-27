import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalPreview } from '../src/components/preview/TerminalPreview';

const noop = (): void => {};

describe('TerminalPreview (SPEC-201 §2.5, AC-10/AC-11)', () => {
  it('preview===null → "preview unavailable" (capture failed)', () => {
    render(
      <TerminalPreview meta={null} text={null} loading={false} exposureEnabled lineCount={12} onToggleExposure={noop} onChangeLineCount={noop} />,
    );
    expect(screen.getByText(/Preview unavailable/i)).toBeTruthy();
  });

  it('lines===0 → "no output" (distinct from unavailable)', () => {
    render(
      <TerminalPreview meta={{ lines: 0, truncated: false, redacted: false }} text={null} loading={false} exposureEnabled lineCount={12} onToggleExposure={noop} onChangeLineCount={noop} />,
    );
    expect(screen.getByText(/No output/i)).toBeTruthy();
    expect(screen.queryByText(/Preview unavailable/i)).toBeNull();
  });

  it('exposure off → hidden, no text rendered', () => {
    render(
      <TerminalPreview meta={{ lines: 3, truncated: false, redacted: false }} text={['secret']} loading={false} exposureEnabled={false} lineCount={12} onToggleExposure={noop} onChangeLineCount={noop} />,
    );
    expect(screen.getByText(/Preview hidden/i)).toBeTruthy();
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('exposure on → shows redacted/truncated badges and min(lineCount, text.length) lines', () => {
    render(
      <TerminalPreview
        meta={{ lines: 9, truncated: true, redacted: true }}
        text={['l1', 'l2', 'l3', 'l4']}
        loading={false}
        exposureEnabled
        lineCount={2}
        onToggleExposure={noop}
        onChangeLineCount={noop}
      />,
    );
    expect(screen.getByText('redacted')).toBeTruthy();
    expect(screen.getByText(/truncated · 9/)).toBeTruthy();
    const pre = document.querySelector('.oc-preview__text') as HTMLElement;
    expect(pre.textContent).toBe('l1\nl2'); // clamped to lineCount=2, no synthesized lines
  });
});
