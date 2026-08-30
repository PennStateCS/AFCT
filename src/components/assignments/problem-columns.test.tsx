/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
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
      'assignmentShowFeedback',
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

  // The trigger is an unlabelled ellipsis, so the accessible name is the only thing
  // telling one row's menu from another's.
  it('actions cell names its menu trigger after the problem', () => {
    render(<>{find(cols(), 'actions').cell(arg(problem({ title: 'Widgets' })))}</>);
    expect(screen.getByRole('button', { name: 'Actions for Widgets' })).toBeInTheDocument();
  });
});

/**
 * The same sorts, but driven through the real DataTable and the DOM.
 *
 * The tests above call `col.sortingFn(...)` off the array literal, which proves the comparator
 * is correct and proves nothing about whether the table ever calls it. That gap is not
 * hypothetical: TanStack Table 9 renames the option from `sortingFn` to `sortFn`, its
 * compatibility layer passes column options through untranslated, and `buildProblemColumns`
 * returns an unannotated literal, so excess-property checking would not flag the stale name
 * either. Under v9 the comparator would sit there, uncalled, with the unit tests above still
 * green and the column silently sorting alphanumerically instead.
 *
 * So these render the table, click the header, and read the order off the screen. They are the
 * tests that would go red.
 */
describe('problem columns, wired into the table', () => {
  const problems = [
    problem({ id: 'p1', title: 'Three', assignmentMaxSubmissions: 3 }),
    problem({ id: 'p2', title: 'Unlimited', assignmentMaxSubmissions: -1 }),
    problem({ id: 'p3', title: 'Two', assignmentMaxSubmissions: 2 }),
  ];

  const autograded = [
    problem({ id: 'p1', title: 'Off one', assignmentAutograderEnabled: false }),
    problem({ id: 'p2', title: 'On one', assignmentAutograderEnabled: true }),
    problem({ id: 'p3', title: 'Not set' }),
  ];

  let view: ReturnType<typeof render>;

  const renderTable = (data: Record<string, any>[]) => {
    view = render(<DataTable columns={cols() as ColumnDef<any>[]} data={data} />);
    return view;
  };

  /**
   * The Title cell of every body row, top to bottom, which is how the order reads.
   *
   * Scoped to `tbody` on purpose: the table also renders a `thead` row and a `tfoot`
   * pagination row, and both answer to the `row` role.
   */
  const titlesOnScreen = () =>
    Array.from(view.container.querySelectorAll('tbody tr')).map(
      (row) => row.querySelectorAll('td')[1]?.textContent ?? '',
    );

  it('puts Unlimited last when Max Submissions is sorted ascending', async () => {
    const user = userEvent.setup();
    renderTable(problems);

    await user.click(screen.getByRole('button', { name: 'Max Submissions' }));

    // Unlimited normalizes to +Infinity, so it sorts after every real number rather than
    // before them, which is what -1 would do untouched.
    expect(titlesOnScreen()).toEqual(['Two', 'Three', 'Unlimited']);
  });

  it('keeps Unlimited first when the same column is sorted descending', async () => {
    const user = userEvent.setup();
    renderTable(problems);

    const header = screen.getByRole('button', { name: 'Max Submissions' });
    await user.click(header);
    await user.click(header);

    expect(titlesOnScreen()).toEqual(['Unlimited', 'Three', 'Two']);
  });

  /**
   * Documentation, not a tripwire, and worth saying so: booleans sort the same way with or
   * without the custom comparator, so unlike the two above this one stays green if the table
   * stops reading `sortingFn`. It earns its place by pinning what happens to a problem the
   * assignment says nothing about, which is the case the comparator's own `-1` branch looks
   * like it handles and does not.
   */
  it('sorts a problem with no autograder setting to the end', async () => {
    const user = userEvent.setup();
    renderTable(autograded);

    await user.click(screen.getByRole('button', { name: 'Autograder' }));

    // Off before On from the comparator, and the unset row last: the table never passes an
    // undefined value to a custom sort, it parks those at the end by itself.
    expect(titlesOnScreen()).toEqual(['Off one', 'On one', 'Not set']);
  });
});

describe('the feedback column', () => {
  const feedbackCol = () => find(cols(), 'assignmentShowFeedback');

  it('says whether students see the evaluator feedback', () => {
    expect(feedbackCol().cell(arg(problem({ assignmentShowFeedback: true })))).toBe('Shown');
    expect(feedbackCol().cell(arg(problem({ assignmentShowFeedback: false })))).toBe('Hidden');
  });

  it('renders nothing when the assignment has no value for it', () => {
    // The per-assignment columns are blank on a problem read outside an assignment, the same
    // way max points and the submission cap are.
    expect(feedbackCol().cell(arg(problem({})))).toBeNull();
  });
});
