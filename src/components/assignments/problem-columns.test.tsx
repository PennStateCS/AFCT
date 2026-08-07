/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { buildProblemColumns, type ProblemColumnsParams } from './problem-columns';

// The columns are a heterogeneous array (accessor + display columns); loosen typing so
// tests can look them up and invoke cell/sort renderers directly.
type AnyCol = any;

const makeParams = (over: Partial<ProblemColumnsParams> = {}): ProblemColumnsParams => ({
  courseIsArchived: false,
  openDescription: vi.fn(),
  openRenderViewer: vi.fn(),
  handleEditProblem: vi.fn(),
  onRemoveProblem: vi.fn(),
  ...over,
});

const cols = (over?: Partial<ProblemColumnsParams>): AnyCol[] =>
  buildProblemColumns(makeParams(over)) as AnyCol[];

const find = (columns: AnyCol[], key: string): AnyCol =>
  columns.find((c) => c.id === key || c.accessorKey === key);

const problem = (over: Record<string, any> = {}) => ({
  id: 'p1',
  title: 'Prob',
  type: 'RE',
  maxStates: 5,
  isDeterministic: false,
  description: null,
  fileName: null,
  originalFileName: null,
  ...over,
});
// A cell's argument shape: `{ row: { original } }`.
const arg = (p: Record<string, any>) => ({ row: { original: p } });

// The placeholder the code renders for a missing value; read from the code so this
// test never hardcodes its exact (em-dash) bytes.
// Missing per-assignment values render as an empty cell (null), not a placeholder.
const BLANK = find(cols(), 'assignmentMaxPoints').cell(arg(problem({})));

describe('buildProblemColumns', () => {
  it('includes the expected columns', () => {
    const ids = cols().map((c) => c.id ?? c.accessorKey);
    expect(ids).toEqual([
      'number',
      'title',
      'type',
      'maxStates',
      'assignmentMaxPoints',
      'assignmentMaxSubmissions',
      'assignmentAutograderEnabled',
      'isDeterministic',
      'answerFile',
      'actions',
    ]);
  });

  it('numbers rows from 1', () => {
    expect(find(cols(), 'number').cell({ row: { index: 0 } })).toBe(1);
    expect(find(cols(), 'number').cell({ row: { index: 4 } })).toBe(5);
  });

  it('maps the problem type to a human label, falling back to the raw type', () => {
    expect(find(cols(), 'type').cell(arg(problem({ type: 'RE' })))).toBe('Regular Expression');
    expect(find(cols(), 'type').cell(arg(problem({ type: 'FA' })))).toBe('Finite Automaton');
    expect(find(cols(), 'type').cell(arg(problem({ type: 'XYZ' })))).toBe('XYZ');
  });

  it('renders -1 as Unlimited for max states and max submissions', () => {
    expect(find(cols(), 'maxStates').cell(arg(problem({ maxStates: -1 })))).toBe('Unlimited');
    expect(find(cols(), 'maxStates').cell(arg(problem({ maxStates: 7 })))).toBe(7);

    const subs = find(cols(), 'assignmentMaxSubmissions');
    expect(subs.cell(arg(problem({ assignmentMaxSubmissions: -1 })))).toBe('Unlimited');
    expect(subs.cell(arg(problem({ assignmentMaxSubmissions: 3 })))).toBe(3);
    expect(BLANK).toBeNull();
    expect(subs.cell(arg(problem({})))).toBeNull(); // missing → blank cell
  });

  it('renders the autograder and deterministic flags', () => {
    const ag = find(cols(), 'assignmentAutograderEnabled');
    expect(ag.cell(arg(problem({ assignmentAutograderEnabled: true })))).toBe('On');
    expect(ag.cell(arg(problem({ assignmentAutograderEnabled: false })))).toBe('Off');
    expect(ag.cell(arg(problem({})))).toBeNull();

    const det = find(cols(), 'isDeterministic');
    expect(det.cell(arg(problem({ isDeterministic: true })))).toBe('Yes');
    expect(det.cell(arg(problem({ isDeterministic: false })))).toBe('No');
  });

  it('sorts "Unlimited" (-1) submissions last', () => {
    const subs = find(cols(), 'assignmentMaxSubmissions');
    const rowWith = (v: number) => ({ getValue: () => v });
    expect(subs.sortingFn(rowWith(3), rowWith(-1), 'x')).toBe(-1); // 3 before unlimited
    expect(subs.sortingFn(rowWith(-1), rowWith(3), 'x')).toBe(1);
    expect(subs.sortingFn(rowWith(2), rowWith(5), 'x')).toBe(-1);
  });

  it('renders the title with a "View description" link that calls openDescription', () => {
    const openDescription = vi.fn();
    const title = find(cols({ openDescription }), 'title');

    const { rerender } = render(
      <>{title.cell(arg(problem({ title: 'Prob', description: 'Hello there' })))}</>,
    );
    // The title always renders; the link only when there's a description.
    expect(screen.getByText('Prob')).toBeInTheDocument();
    fireEvent.click(screen.getByText('View description'));
    // The whole problem is handed over now, so the dialog can render either description form.
    expect(openDescription).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Prob', description: 'Hello there' }),
    );

    rerender(<>{title.cell(arg(problem({ title: 'Prob', description: null })))}</>);
    expect(screen.queryByText('View description')).not.toBeInTheDocument();
  });

  it('answer-file cell: the file name opens the viewer, with a download link, else "No file"', () => {
    const openRenderViewer = vi.fn();
    const answer = find(cols({ openRenderViewer }), 'answerFile');

    const { rerender } = render(
      <>{answer.cell(arg(problem({ fileName: 'sol.jff', originalFileName: 'mine.jff' })))}</>,
    );
    // Clicking the file name opens the render viewer.
    fireEvent.click(screen.getByRole('button', { name: 'mine.jff' }));
    expect(openRenderViewer).toHaveBeenCalledTimes(1);
    // A download link sits beside it.
    expect(screen.getByRole('link', { name: /Download mine.jff/ })).toBeInTheDocument();

    rerender(<>{answer.cell(arg(problem({ fileName: null })))}</>);
    expect(screen.getByText('No file')).toBeInTheDocument();
  });

  it('actions cell exposes a per-problem Manage menu trigger', () => {
    render(<>{find(cols(), 'actions').cell(arg(problem({ title: 'Widgets' })))}</>);
    expect(screen.getByRole('button', { name: 'Manage problem Widgets' })).toBeInTheDocument();
  });
});
