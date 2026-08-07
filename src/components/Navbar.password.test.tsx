/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The navbar used to pass a no-op () => Promise.resolve() to the dialog, so the dialog showed
// "success" without ever calling the API. These tests prove it now wires the real hook.

const updateMock = vi.fn();
let capturedOnChangePassword: ((oldP: string, newP: string) => Promise<void>) | undefined;

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'u1', email: 'u@example.com', name: 'U', role: 'STUDENT' } },
    status: 'authenticated',
    update: updateMock,
  }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/components/navbar/NavbarBreadcrumbContext', () => ({
  useNavbarBreadcrumbs: () => ({ courseLabel: null, assignmentLabel: null }),
}));
vi.mock('./ui/EnhancedSidebarTrigger', () => ({ EnhancedSidebarTrigger: () => <div /> }));
vi.mock('@/components/dialogs/EditProfileDialog', () => ({ EditProfileDialog: () => <div /> }));
vi.mock('@/components/dialogs/ChangePasswordDialog', () => ({
  ChangePasswordDialog: (props: { onChangePassword: (oldP: string, newP: string) => Promise<void> }) => {
    capturedOnChangePassword = props.onChangePassword;
    return <div data-testid="change-password-dialog" />;
  },
}));
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: ({ children, ...props }: { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuLabel: Pass,
    DropdownMenuRadioGroup: Pass,
    DropdownMenuRadioItem: Pass,
  };
});

import Navbar from './Navbar';

describe('Navbar password change', () => {
  beforeEach(() => {
    updateMock.mockReset();
    capturedOnChangePassword = undefined;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The dialog is loaded on demand and only rendered once opened, so it does not exist until
   * the menu item is used. Opening it is what makes the wiring observable.
   */
  async function openChangePasswordDialog() {
    expect(capturedOnChangePassword).toBeUndefined();
    fireEvent.click(screen.getByText('Change Password'));
    await waitFor(() => expect(capturedOnChangePassword).toBeTypeOf('function'));
  }

  it('calls the real password API and refreshes the session on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<Navbar />);
    await openChangePasswordDialog();
    await capturedOnChangePassword!('OldPass1!', 'NewPass1!');

    expect(fetchMock).toHaveBeenCalledWith('/api/me/password', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      oldPassword: 'OldPass1!',
      newPassword: 'NewPass1!',
    });
    expect(updateMock).toHaveBeenCalledWith({ refreshCredentials: true });
  });

  it('rejects with the server error and does not refresh the session on failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'Old password is incorrect' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<Navbar />);
    await openChangePasswordDialog();
    await expect(capturedOnChangePassword!('x', 'y')).rejects.toThrow('Old password is incorrect');
    expect(updateMock).not.toHaveBeenCalled();
  });
});
