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

  it('disables the enroll button when the course is archived', async () => {
    const user = userEvent.setup();

    render(
      <EnrollUserDialog open setOpen={vi.fn()} courseIsArchived users={users} onEnroll={vi.fn()} />,
    );

    await user.click(screen.getByLabelText(/Ada\s+Lovelace/));
    expect(screen.getByRole('button', { name: 'Enroll' })).toBeDisabled();
  });
});
