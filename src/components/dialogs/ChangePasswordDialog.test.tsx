/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChangePasswordDialog } from './ChangePasswordDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

describe('ChangePasswordDialog', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('submits password changes', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onChangePassword = vi.fn().mockResolvedValue(undefined);

    render(<ChangePasswordDialog open setOpen={setOpen} onChangePassword={onChangePassword} />);

    await user.type(screen.getByLabelText('Old Password'), 'OldPass1!');
    await user.type(screen.getByLabelText('New Password'), 'NewPass1!');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass1!');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onChangePassword).toHaveBeenCalledWith('OldPass1!', 'NewPass1!'));
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalledWith('Password changed successfully!');
  });

  it('surfaces API errors', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onChangePassword = vi.fn().mockRejectedValue(new Error('Nope'));

    render(<ChangePasswordDialog open setOpen={setOpen} onChangePassword={onChangePassword} />);

    await user.type(screen.getByLabelText('Old Password'), 'OldPass1!');
    await user.type(screen.getByLabelText('New Password'), 'NewPass1!');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass1!');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Nope'));
    expect(setOpen).not.toHaveBeenCalledWith(false);
  });
});
