/** @vitest-environment jsdom */

/**
 * The gradebook's edit dialog, rendered through the real table.
 *
 * Its sibling suite stubs `DataTable`, which is the right call for testing what the dialog does
 * with its data and the exact reason this file exists: a stub renders whatever columns it is
 * handed, so it cannot notice the table declining to render one. The grade field carried
 * `priority: 3`, meaning `hidden lg:table-cell`, and the priorities are measured against the
 * viewport rather than the dialog they are inside. On any window under 1024px the dialog opened,
 * offered to "edit individual problem scores", and showed no field to edit and a Save button
 * that could never enable.
 *
 * jsdom applies no media queries, so nothing here can prove how it looks at a given width. What
 * it can prove is that the field is not marked droppable, which is the decision that broke it.
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GradeBreakdownDialog } from './GradeBreakdownDialog';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

const assignmentPayload = {
  problems: [{ problem: { id: 'p1', title: 'Test' }, maxPoints: 100, autograderEnabled: false }],
};

const renderDialog = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GradeBreakdownDialog
        courseId="c1"
        assignmentId="a1"
        assignmentTitle="Test"
        studentId="s1"
        studentName="Remy LeBeau"
        open
        setOpen={() => {}}
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/courses/c1/assignments/a1') {
        return Promise.resolve({ ok: true, json: async () => assignmentPayload });
      }
      // No grade recorded and no submission: the state this was reported in.
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
});

describe('the grade field', () => {
  it('is rendered by the real table', async () => {
    renderDialog();

    // The dialog's whole purpose. Without it there is nothing to type into and Save can never
    // become enabled, however long somebody looks at it.
    expect(await screen.findByRole('spinbutton', { name: /Grade for Test/ })).toBeInTheDocument();
  });

  it('is not in a column the table is allowed to drop', async () => {
    renderDialog();

    const field = await screen.findByRole('spinbutton', { name: /Grade for Test/ });
    const cell = field.closest('td');

    // `hidden` here is the responsive priority classes, which measure the window rather than
    // the dialog, so a narrow window took the field away entirely.
    expect(cell?.className ?? '').not.toMatch(/\bhidden\b/);
  });

  it('offers a grade even with no submission and nothing graded yet', async () => {
    renderDialog();

    await waitFor(() => expect(screen.getByText('Not graded')).toBeInTheDocument());
    const field = screen.getByRole('spinbutton', { name: /Grade for Test/ });
    expect(field).toBeEnabled();
    expect(within(field.closest('tr')!).getByText('100')).toBeInTheDocument();
  });
});
