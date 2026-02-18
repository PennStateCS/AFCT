/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { AssociateProblemsDialog } from './AssociateProblemsDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);
vi.mock('@/components/ui/switch', () => import('@/test/mocks/ui').then((mod) => mod.switchMock));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

describe('AssociateProblemsDialog', () => {
  const baseProblem = { id: 'p1', title: 'Deterministic FA', type: 'FA' };

  it('approves a problem and saves configuration', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onAddProblems = vi.fn();

    render(
      <AssociateProblemsDialog
        open
        onClose={onClose}
        courseIsArchived={false}
        allProblems={[baseProblem]}
        usedProblems={[]}
        onAddProblems={onAddProblems}
      />,
    );

    await user.click(screen.getByText('Deterministic FA'));
    const pointsInput = screen.getByLabelText('Max Points');
    await user.clear(pointsInput);
    await user.type(pointsInput, '10');

    const submissionsInput = screen.getByLabelText('Max Submissions');
    await user.clear(submissionsInput);
    await user.type(submissionsInput, '3');

    await user.click(screen.getByRole('button', { name: /Approve/i }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onAddProblems).toHaveBeenCalledWith([
      {
        problemId: 'p1',
        maxPoints: 10,
        maxSubmissions: 3,
        autograderEnabled: true,
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('disables saving when the course is archived', async () => {
    const user = userEvent.setup();

    render(
      <AssociateProblemsDialog
        open
        onClose={vi.fn()}
        courseIsArchived
        allProblems={[baseProblem]}
        usedProblems={[]}
        onAddProblems={vi.fn()}
      />,
    );

    await user.click(screen.getByText('Deterministic FA'));
    await user.click(screen.getByRole('button', { name: /Approve/i }));

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });
});
