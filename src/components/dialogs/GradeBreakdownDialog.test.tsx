/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { GradeBreakdownDialog } from './GradeBreakdownDialog';

// Fresh QueryClient per test (retry off, no lingering cache) so each dialog's
// two queries start clean.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
const toastError = toastMock.error;

// Row shape as produced by the component (mirrors its internal Row type).
type Row = {
  id: string;
  problemId: string;
  title: string;
  maxPoints: number;
  grade: number | null;
  storedGrade: number | null;
  autograderEnabled: boolean;
  gradedManually: boolean;
  gradeSource: 'AUTOGRADER' | 'MANUAL';
};

// DataTable stub: render each row's title, and render the real Grade column's
// `cell` output so the wired Input drives the component's handleGradeChange.
// This is how the component becomes dirty for the Save-path test.
vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
    loading,
  }: {
    columns: ColumnDef<Row, unknown>[];
    data: Row[];
    loading?: boolean;
  }) => {
    const gradeColumn = columns.find((c) => c.id === 'Grade');
    const gradingColumn = columns.find((c) => c.id === 'Grading');
    return (
      <div>
        <div data-testid="table-loading">{String(!!loading)}</div>
        <div data-testid="table-rows">{data.length}</div>
        <ul>
          {data.map((r) => (
            <li key={r.id} data-testid={`row-${r.problemId}`}>
              <span data-testid={`title-${r.problemId}`}>{r.title}</span>
              <span data-testid={`grade-${r.problemId}`}>
                {r.grade === null ? 'null' : String(r.grade)}
              </span>
              <span data-testid={`grading-${r.problemId}`}>
                {gradingColumn?.cell
                  ? (gradingColumn.cell as (ctx: { row: { original: Row } }) => React.ReactNode)({
                      row: { original: r },
                    })
                  : null}
              </span>
              <span data-testid={`gradecell-${r.problemId}`}>
                {gradeColumn?.cell
                  ? // Invoke the real cell renderer for this row so the Input is
                    // wired to the component's onChange handler.
                    (gradeColumn.cell as (ctx: { row: { original: Row } }) => React.ReactNode)({
                      row: { original: r },
                    })
                  : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  },
}));

type FetchResult = { ok: boolean; status?: number; json: () => Promise<unknown> };

const baseProps = {
  courseId: 'c1',
  assignmentId: 'a1',
  assignmentTitle: 'HW 1',
  studentId: 's1',
  studentName: 'Ada',
  open: true,
};

const assignmentPayload = {
  problems: [
    { problem: { id: 'p1', title: 'Problem One' }, maxPoints: 10, autograderEnabled: true },
    { problem: { id: 'p2', title: 'Problem Two' }, maxPoints: 20, autograderEnabled: false },
  ],
};

describe('GradeBreakdownDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches both reads and renders a row per problem with seeded grades', async () => {
    const fetchMock = vi.fn((url: string): Promise<FetchResult> => {
      if (url === '/api/courses/c1/assignments/a1') {
        return Promise.resolve({ ok: true, json: async () => assignmentPayload });
      }
      if (url === '/api/courses/c1/assignments/a1/problem-grades/s1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ p1: { grade: 7 }, p2: { grade: null } }),
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<GradeBreakdownDialog {...baseProps} setOpen={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });

    // Both reads fired.
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain('/api/courses/c1/assignments/a1');
    expect(urls).toContain('/api/courses/c1/assignments/a1/problem-grades/s1');

    // Rows rendered with seeded grades.
    expect(screen.getByTestId('title-p1').textContent).toBe('Problem One');
    expect(screen.getByTestId('title-p2').textContent).toBe('Problem Two');
    expect(screen.getByTestId('grade-p1').textContent).toBe('7');
    expect(screen.getByTestId('grade-p2').textContent).toBe('null');
  });

  /**
   * The Grading column reports where each grade came from. It used to report the problem's
   * autograder setting instead, so p1 below (autograded problem, grade typed by a person)
   * read as "Autograded" when a person had overridden it.
   */
  describe('the Grading column', () => {
    const renderWithGrades = async (grades: Record<string, unknown>) => {
      const fetchMock = vi.fn((url: string): Promise<FetchResult> => {
        if (url === '/api/courses/c1/assignments/a1') {
          return Promise.resolve({ ok: true, json: async () => assignmentPayload });
        }
        if (url === '/api/courses/c1/assignments/a1/problem-grades/s1') {
          return Promise.resolve({ ok: true, json: async () => grades });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithClient(<GradeBreakdownDialog {...baseProps} setOpen={vi.fn()} />);
      await waitFor(() => {
        expect(screen.getByTestId('table-rows').textContent).toBe('2');
      });
    };

    // p1 has the autograder on, p2 has it off. Both grades below were typed by a person,
    // and only one of them overrode anything.
    it('calls a hand-entered grade an override only where an autograder would run', async () => {
      await renderWithGrades({
        p1: { grade: 7, gradedManually: true, gradeSource: 'MANUAL' },
        p2: { grade: 15, gradedManually: true, gradeSource: 'MANUAL' },
      });

      // p1 also carries the padlock, since the autograder is what it is held against. p2
      // gets no padlock: nothing there would overwrite it, so a lock would imply a danger
      // that does not exist on a hand-graded problem.
      expect(screen.getByTestId('grading-p1').textContent).toBe('Manual override, held');
      expect(screen.getByTestId('grading-p2').textContent).toBe('Manually graded');
    });

    it('credits the autograder for its own grades, and says when there is none', async () => {
      await renderWithGrades({
        p1: { grade: 9, gradedManually: false, gradeSource: 'AUTOGRADER' },
      });

      expect(screen.getByTestId('grading-p1').textContent).toBe('Autograded');
      expect(screen.getByTestId('grading-p2').textContent).toBe('Not graded');
    });

    /**
     * Releasing a grade hands it back to the autograder; it does not rewrite who set it.
     * The badge used to flip to "Autograded" here, telling a grader the autograder had
     * chosen a number they had typed themselves.
     */
    it('still credits the person who set a grade that has been released', async () => {
      await renderWithGrades({
        p1: { grade: 7, gradedManually: false, gradeSource: 'MANUAL' },
      });

      expect(screen.getByTestId('grading-p1').textContent).toBe('Manual override');
    });

    // The badge describes what is stored. Typing into the box does not make it true yet.
    it('does not relabel a grade that has only been typed', async () => {
      await renderWithGrades({});

      fireEvent.change(screen.getByLabelText(/Grade for Problem One/), {
        target: { value: '5' },
      });

      expect(screen.getByTestId('grading-p1').textContent).toBe('Not graded');
    });
  });

  it('warns that saving here holds the grades against the autograder', async () => {
    const fetchMock = vi.fn((url: string): Promise<FetchResult> => {
      if (url === '/api/courses/c1/assignments/a1') {
        return Promise.resolve({ ok: true, json: async () => assignmentPayload });
      }
      if (url === '/api/courses/c1/assignments/a1/problem-grades/s1') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<GradeBreakdownDialog {...baseProps} setOpen={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });
    expect(screen.getByText(/re-running the autograder will not change them/i)).toBeInTheDocument();
  });

  it('handles a 204 on problem-grades (rows with null grades, no crash)', async () => {
    const fetchMock = vi.fn((url: string): Promise<FetchResult> => {
      if (url === '/api/courses/c1/assignments/a1') {
        return Promise.resolve({ ok: true, json: async () => assignmentPayload });
      }
      if (url === '/api/courses/c1/assignments/a1/problem-grades/s1') {
        return Promise.resolve({
          ok: true,
          status: 204,
          json: async () => {
            throw new Error('no body');
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<GradeBreakdownDialog {...baseProps} setOpen={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });

    expect(screen.getByTestId('grade-p1').textContent).toBe('null');
    expect(screen.getByTestId('grade-p2').textContent).toBe('null');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('saves via ONE bulk POST, invalidates, calls onSaved and closes', async () => {
    const onSaved = vi.fn();
    const setOpen = vi.fn();
    const fetchMock = vi.fn((url: string, init?: RequestInit): Promise<FetchResult> => {
      if (url === '/api/courses/c1/assignments/a1') {
        return Promise.resolve({ ok: true, json: async () => assignmentPayload });
      }
      if (url === '/api/courses/c1/assignments/a1/problem-grades/s1' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, changed: 1 }) });
      }
      if (url === '/api/courses/c1/assignments/a1/problem-grades/s1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ p1: { grade: 7 }, p2: { grade: null } }),
        });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? ''}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<GradeBreakdownDialog {...baseProps} setOpen={setOpen} onSaved={onSaved} />);

    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });

    // Drive the real Grade input for p1 to make the form dirty.
    const p1Input = screen.getByTestId('gradecell-p1').querySelector('input') as HTMLInputElement;
    fireEvent.change(p1Input, { target: { value: '9' } });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(toastMock.saved).toHaveBeenCalledWith('Grades');

    // Exactly one POST to the bulk problem-grades endpoint (studentId in the URL).
    const postCalls = fetchMock.mock.calls.filter(
      (c) =>
        c[0] === '/api/courses/c1/assignments/a1/problem-grades/s1' &&
        (c[1] as RequestInit)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(1);

    const body = JSON.parse((postCalls[0][1] as RequestInit).body as string);
    // studentId is no longer in the body; it lives in the URL path.
    expect(body).not.toHaveProperty('studentId');
    expect(body.grades).toMatchObject({ p1: 9 });

    // No per-problem fan-out requests.
    const fanOut = fetchMock.mock.calls.filter((c) =>
      /\/problems\/[^/]+\/grade\//.test(c[0] as string),
    );
    expect(fanOut).toHaveLength(0);

    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('blocks the save and toasts when a grade exceeds its problem max', async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn((url: string, init?: RequestInit): Promise<FetchResult> => {
      if (url === '/api/courses/c1/assignments/a1') {
        return Promise.resolve({ ok: true, json: async () => assignmentPayload });
      }
      if (url === '/api/courses/c1/assignments/a1/problem-grades/s1' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, changed: 1 }) });
      }
      if (url === '/api/courses/c1/assignments/a1/problem-grades/s1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ p1: { grade: 7 }, p2: { grade: null } }),
        });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? ''}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<GradeBreakdownDialog {...baseProps} setOpen={vi.fn()} onSaved={onSaved} />);

    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });

    // p1 max is 10; 999 is out of range.
    const p1Input = screen.getByTestId('gradecell-p1').querySelector('input') as HTMLInputElement;
    fireEvent.change(p1Input, { target: { value: '999' } });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    // Error surfaced, and no POST was made.
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Problem One'));
    const postCalls = fetchMock.mock.calls.filter(
      (c) =>
        c[0] === '/api/courses/c1/assignments/a1/problem-grades/s1' &&
        (c[1] as RequestInit)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows a toast when the assignment read fails', async () => {
    const fetchMock = vi.fn((url: string): Promise<FetchResult> => {
      if (url === '/api/courses/c1/assignments/a1') {
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }
      if (url === '/api/courses/c1/assignments/a1/problem-grades/s1') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<GradeBreakdownDialog {...baseProps} setOpen={vi.fn()} />);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'Could not load the grade breakdown. Close and reopen this dialog to try again.',
      );
    });
  });
});
