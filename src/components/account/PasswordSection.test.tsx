/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PasswordSection } from './PasswordSection';

vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);

import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
const toastSuccess = toastMock.success;
const toastError = toastMock.error;

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Current password'), 'OldPass1!');
  await user.type(screen.getByLabelText('New password'), 'NewPass1!');
  await user.type(screen.getByLabelText('Confirm new password'), 'NewPass1!');
};

describe('PasswordSection', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('submits the old and new password', async () => {
    const user = userEvent.setup();
    const onChangePassword = vi.fn().mockResolvedValue(undefined);

    render(<PasswordSection onChangePassword={onChangePassword} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(onChangePassword).toHaveBeenCalledWith('OldPass1!', 'NewPass1!'));
    expect(toastSuccess).toHaveBeenCalledWith('Password changed');
  });

  /**
   * This was a dialog, which cleared itself by closing. On a page nothing disappears, so the
   * fields have to be emptied deliberately: three password boxes left filled in on a shared
   * machine is exactly the wrong thing to leave behind.
   */
  it('clears the fields after a successful change', async () => {
    const user = userEvent.setup();

    render(<PasswordSection onChangePassword={vi.fn().mockResolvedValue(undefined)} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''));
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('surfaces an API error and keeps what was typed', async () => {
    const user = userEvent.setup();

    render(<PasswordSection onChangePassword={vi.fn().mockRejectedValue(new Error('Nope'))} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Nope'));
    // Losing the entry on failure would mean retyping all three for a server-side hiccup.
    expect(screen.getByLabelText('Current password')).toHaveValue('OldPass1!');
  });

  it('will not submit until something has been entered', () => {
    render(<PasswordSection onChangePassword={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
  });
});
