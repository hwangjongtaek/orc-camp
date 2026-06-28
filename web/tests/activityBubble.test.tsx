/**
 * SPEC-301-AC-06 — activity bubble content (summary + source + estimated marker; INV-4).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityBubble } from '../src/components/scene/ActivityBubble';

describe('SPEC-301-AC-06 ActivityBubble', () => {
  it('AC-06: shows summary + source + estimated marker when estimated', () => {
    render(
      <ActivityBubble
        currentWorkSummary="rebuilding index"
        summarySource="recent_output"
        summaryIsEstimated={true}
      />,
    );
    expect(screen.getByText('rebuilding index')).toBeTruthy();
    expect(screen.getByText('~est.')).toBeTruthy();
    expect(screen.getByText(/source: recent_output/)).toBeTruthy();
  });

  it('AC-06: no estimated marker when summaryIsEstimated is false', () => {
    render(
      <ActivityBubble
        currentWorkSummary="running tests"
        summarySource="pane_title"
        summaryIsEstimated={false}
      />,
    );
    expect(screen.getByText('running tests')).toBeTruthy();
    expect(screen.queryByText('~est.')).toBeNull();
  });

  it('AC-06/INV-4: null summary renders "no summary" (no synthesis)', () => {
    render(
      <ActivityBubble currentWorkSummary={null} summarySource="unknown" summaryIsEstimated={true} />,
    );
    expect(screen.getByText('no summary')).toBeTruthy();
    expect(screen.queryByText('~est.')).toBeNull();
  });
});
