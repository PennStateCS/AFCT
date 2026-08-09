/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ProgressRing } from './ProgressRing';

describe('ProgressRing', () => {
  it('shows the figure and its caption', () => {
    render(<ProgressRing label="Graded" value={2} total={3} srLabel="2 of 3 problems graded" />);

    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('Graded')).toBeInTheDocument();
  });

  it('accepts a display value that is not just value over total', () => {
    render(
      <ProgressRing
        label="Assignment score"
        value={90}
        total={210}
        display="43%"
        srLabel="90 of 210 points"
      />,
    );

    expect(screen.getByText('43%')).toBeInTheDocument();
  });

  // The ring is decorative: a donut says nothing to a screen reader, so the meaning has to be
  // in words rather than in the arc.
  it('states the figure in words for assistive tech', () => {
    render(<ProgressRing label="Graded" value={2} total={3} srLabel="2 of 3 problems graded" />);

    expect(screen.getByText('2 of 3 problems graded')).toBeInTheDocument();
  });

  // An assignment with no points or no problems is 0/0. Dividing by zero would render an
  // invisible arc and, worse, NaN in the dash offset.
  it('treats nothing-to-do as complete rather than dividing by zero', () => {
    const { container } = render(
      <ProgressRing label="Graded" value={0} total={0} srLabel="Nothing to grade" />,
    );

    const arcs = container.querySelectorAll('circle');
    const offset = arcs[1]?.getAttribute('stroke-dashoffset');
    expect(offset).toBe('0');
    expect(offset).not.toContain('NaN');
  });

  it('never draws past full when the value exceeds the total', () => {
    const { container } = render(
      <ProgressRing label="Score" value={12} total={10} srLabel="12 of 10 points" />,
    );

    const arcs = container.querySelectorAll('circle');
    expect(arcs[1]?.getAttribute('stroke-dashoffset')).toBe('0');
  });
});
