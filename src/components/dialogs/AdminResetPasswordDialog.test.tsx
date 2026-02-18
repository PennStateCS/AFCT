/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AdminResetPasswordDialog } from './AdminResetPasswordDialog';

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

describe('AdminResetPasswordDialog', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('submits a valid password', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onResetPassword = vi.fn().mockResolvedValue(undefined);

    render(
      <AdminResetPasswordDialog
        open
        setOpen={setOpen}
        onResetPassword={onResetPassword}
        targetUserName="Ada"
      />,
    );

    await user.type(screen.getByLabelText('New Password'), 'StrongPass1');
    await user.type(screen.getByLabelText('Confirm New Password'), 'StrongPass1');

    await user.click(screen.getByRole('button', { name: 'Reset Password' }));

    await waitFor(() => expect(onResetPassword).toHaveBeenCalledWith('StrongPass1'));
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalledWith('Password reset successfully!');
  });

  it('shows an error when passwords do not match', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onResetPassword = vi.fn();

    render(<AdminResetPasswordDialog open setOpen={setOpen} onResetPassword={onResetPassword} />);

    await user.type(screen.getByLabelText('New Password'), 'StrongPass1');
    await user.type(screen.getByLabelText('Confirm New Password'), 'Mismatch1');

    await user.click(screen.getByRole('button', { name: 'Reset Password' }));

    expect(onResetPassword).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Passwords don't match");
  });
});
