/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProblemPicker } from './ProblemPicker';

const problems = [
  { id: 'p1', title: 'Collatz Binary', maxPoints: 50 },
  { id: 'p2', title: 'D Flip-Flop', maxPoints: 70 },
  { id: 'p3', title: 'Traffic Light', maxPoints: 90 },
];

const grades = { p1: null, p2: null, p3: 90 };

const renderPicker = (props: Partial<React.ComponentProps<typeof ProblemPicker>> = {}) =>
  render(
    <ProblemPicker
      problems={problems}
      selectedProblemId="p3"
      onSelect={vi.fn()}
      grades={grades}
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProblemPicker', () => {
  it('shows the selected problem on the trigger', () => {
    renderPicker();

    expect(screen.getByRole('button', { name: /Traffic Light/ })).toBeInTheDocument();
  });

  // This picker replaces the standing problem list, so it has to carry what that list
  // carried: every problem and its grade, not just the one being reviewed.
  it('lists every problem with its grade', async () => {
    renderPicker();

    await userEvent.click(screen.getByRole('button', { name: /Traffic Light/ }));

    expect(await screen.findByText('1. Collatz Binary')).toBeInTheDocument();
    expect(screen.getByText('2. D Flip-Flop')).toBeInTheDocument();
    expect(screen.getByText('90/90')).toBeInTheDocument();
  });

  // The dash is the visible, non-colour signal that nothing has been entered yet.
  it('shows a dash rather than a number for an ungraded problem', async () => {
    renderPicker();

    await userEvent.click(screen.getByRole('button', { name: /Traffic Light/ }));

    expect(await screen.findByText('—/50')).toBeInTheDocument();
    expect(screen.getByText('—/70')).toBeInTheDocument();
  });

  // Colour alone fails a red-green deficiency, and a dot conveys nothing to a screen reader.
  it('states the grading status in text', async () => {
    renderPicker();

    await userEvent.click(screen.getByRole('button', { name: /Traffic Light/ }));

    expect(await screen.findByText('Graded')).toBeInTheDocument();
    expect(screen.getAllByText('Needs grading')).toHaveLength(2);
  });

  // How much is left is the question a grader has, and it should not require opening the
  // menu and counting dashes.
  it('reports the outstanding count on the trigger', () => {
    renderPicker();

    expect(
      screen.getByRole('button', { name: /2 still need grading/ }),
    ).toBeInTheDocument();
  });

  it('says so when nothing is outstanding', () => {
    renderPicker({ grades: { p1: 10, p2: 20, p3: 90 } });

    expect(screen.getByRole('button', { name: /All graded/ })).toBeInTheDocument();
  });

  it('reports the chosen problem', async () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });

    await userEvent.click(screen.getByRole('button', { name: /Traffic Light/ }));
    await userEvent.click(await screen.findByText('1. Collatz Binary'));

    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('falls back to the first problem when none is selected', () => {
    renderPicker({ selectedProblemId: null });

    expect(screen.getByRole('button', { name: /Collatz Binary/ })).toBeInTheDocument();
  });
});

describe('stepping between problems', () => {
  it('moves to the previous and next problem', async () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect, selectedProblemId: 'p2' });

    await userEvent.click(screen.getByRole('button', { name: 'Next problem' }));
    expect(onSelect).toHaveBeenCalledWith('p3');

    await userEvent.click(screen.getByRole('button', { name: 'Previous problem' }));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  // Wrapping keeps the arrows useful at either end rather than dead-ending.
  it('wraps around at both ends', async () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect, selectedProblemId: 'p3' });

    await userEvent.click(screen.getByRole('button', { name: 'Next problem' }));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('disables stepping when there is only one problem', () => {
    renderPicker({ problems: [problems[0]!], selectedProblemId: 'p1' });

    expect(screen.getByRole('button', { name: 'Next problem' })).toBeDisabled();
  });
});
