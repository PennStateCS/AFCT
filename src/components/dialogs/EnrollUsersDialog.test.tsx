/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { EnrollUserDialog } from './EnrollUsersDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

describe('EnrollUsersDialog', () => {
  const users = [
    { id: '1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', role: 'STUDENT' },
    { id: '2', firstName: 'Alan', lastName: 'Turing', email: 'alan@example.com', role: 'TA' },
  ];

  it('enrolls selected users', async () => {
    const user = userEvent.setup();
    const onEnroll = vi.fn();
    const setOpen = vi.fn();

    render(
      <EnrollUserDialog
        open
        setOpen={setOpen}
        courseIsArchived={false}
        users={users}
        onEnroll={onEnroll}
      />,
    );

    await user.click(screen.getByLabelText(/Ada\s+Lovelace/));
    await user.click(screen.getByLabelText(/Alan\s+Turing/));

    await user.click(screen.getByRole('button', { name: 'Enroll' }));

    expect(onEnroll).toHaveBeenCalledTimes(2);
    expect(onEnroll).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    expect(onEnroll).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('moves real focus through the list with the arrow keys', async () => {
    const user = userEvent.setup();

    render(
      <EnrollUserDialog
        open
        setOpen={vi.fn()}
        courseIsArchived={false}
        users={users}
        onEnroll={vi.fn()}
      />,
    );

    const ada = screen.getByLabelText(/Ada\s+Lovelace/);
    const alan = screen.getByLabelText(/Alan\s+Turing/);

    // Arrowing from the search box focuses the row itself, so a screen reader
    // announces who Enter would act on (the old code only repainted a highlight).
    screen.getByLabelText('Search users').focus();
    await user.keyboard('{ArrowDown}');
    expect(ada).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(alan).toHaveFocus();

    // Wraps around, and the list stays a single tab stop (roving tabindex).
    await user.keyboard('{ArrowDown}');
    expect(ada).toHaveFocus();
    expect(ada).toHaveAttribute('tabindex', '0');
    expect(alan).toHaveAttribute('tabindex', '-1');
  });

  it('does not put an inert tab stop on each row label', () => {
    render(
      <EnrollUserDialog
        open
        setOpen={vi.fn()}
        courseIsArchived={false}
        users={users}
        onEnroll={vi.fn()}
      />,
    );

    for (const label of document.querySelectorAll('label[for^="enroll-checkbox-"]')) {
      expect(label.hasAttribute('tabindex')).toBe(false);
    }
  });

  it('disables the enroll button when the course is archived', async () => {
    const user = userEvent.setup();

    render(
      <EnrollUserDialog open setOpen={vi.fn()} courseIsArchived users={users} onEnroll={vi.fn()} />,
    );

    await user.click(screen.getByLabelText(/Ada\s+Lovelace/));
    expect(screen.getByRole('button', { name: 'Enroll' })).toBeDisabled();
  });
});
