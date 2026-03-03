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
        courseId="course-1"
        courseIsArchived={false}
        allProblems={[baseProblem]}
        usedProblems={[]}
        onAddProblems={onAddProblems}
      />,
    );

    await user.click(await screen.findByText('Deterministic FA'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onAddProblems).toHaveBeenCalledWith(['p1'], undefined);
    expect(onClose).toHaveBeenCalled();
  });

  it('disables saving when the course is archived', async () => {
    const user = userEvent.setup();

    render(
      <AssociateProblemsDialog
        open
        onClose={vi.fn()}
        courseId="course-1"
        courseIsArchived
        allProblems={[baseProblem]}
        usedProblems={[]}
        onAddProblems={vi.fn()}
      />,
    );

    await user.click(await screen.findByText('Deterministic FA'));

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });
});
