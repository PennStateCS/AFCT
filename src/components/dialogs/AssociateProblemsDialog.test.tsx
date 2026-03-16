/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, it, expect, vi } from 'vitest';

import { AssociateProblemsDialog } from './AssociateProblemsDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);
vi.mock('@/components/ui/switch', () => import('@/test/mocks/ui').then((mod) => mod.switchMock));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  const globalAny = globalThis as Record<string, unknown>;

  if (!globalAny.ResizeObserver) {
    globalAny.ResizeObserver = ResizeObserverMock;
  }

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }

  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }

  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }

  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
});

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

    await user.click(await screen.findByRole('combobox', { name: 'Problem' }));
    await user.click(await screen.findByRole('option', { name: 'Deterministic FA' }));
    await user.clear(screen.getByLabelText(/max points/i));
    await user.type(screen.getByLabelText(/max points/i), '12');
    await user.click(screen.getByRole('switch', { name: 'Unlimited Submissions' }));
    await user.clear(screen.getByLabelText(/max submissions/i));
    await user.type(screen.getByLabelText(/max submissions/i), '4');
    await user.click(screen.getByRole('button', { name: 'Add Problem' }));

    expect(onAddProblems).toHaveBeenCalledWith(['p1'], undefined, [
      {
        problemId: 'p1',
        maxPoints: 12,
        maxSubmissions: 4,
        autograderEnabled: true,
      },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('disables saving when the course is archived', async () => {
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

    expect(await screen.findByRole('button', { name: 'Add Problem' })).toBeDisabled();
  });
});
