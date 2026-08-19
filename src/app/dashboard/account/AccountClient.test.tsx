/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateMock = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'u1' } }, update: updateMock }),
}));

// The profile form is exercised by its own tests; here it only has to exist so the tabs render.
vi.mock('@/components/account/ProfileSection', () => ({
  ProfileSection: () => <div data-testid="profile-section" />,
}));

// Captured so the wiring between the page and the shared hook can be called directly, the way
// the Navbar test used to reach it through the dialog's props.
let capturedOnChangePassword: ((oldP: string, newP: string) => Promise<void>) | undefined;
vi.mock('@/components/account/PasswordSection', () => ({
  PasswordSection: (props: { onChangePassword: (o: string, n: string) => Promise<void> }) => {
    capturedOnChangePassword = props.onChangePassword;
    return <div data-testid="password-section" />;
  },
}));

import AccountClient from './AccountClient';
import type { SessionUser } from '@/types/next-auth';

const user = { id: 'u1', email: 'ada@example.com' } as SessionUser;

beforeEach(() => {
  updateMock.mockReset();
  capturedOnChangePassword = undefined;
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountClient', () => {
  it('opens on the profile tab', () => {
    render(<AccountClient user={user} oidcAvailable={false} oidcLabel={null} />);

    expect(screen.getByTestId('profile-section')).toBeInTheDocument();
  });

  it('remembers the tab you were last on', async () => {
    const person = userEvent.setup();
    render(<AccountClient user={user} oidcAvailable={false} oidcLabel={null} />);
    await person.click(screen.getByRole('tab', { name: /password/i }));

    expect(localStorage.getItem('afct.accountTab')).toBe('password');
  });

  /**
   * The tab is always there.
   *
   * It used to appear only while institutional sign-in was configured, which hid identities
   * that still existed: an LMS launch attaches one too, and turning the provider off left
   * people unable to see or remove anything attached to their account. What being unavailable
   * changes is whether a new one can be connected.
   */
  describe('the connected-accounts tab', () => {
    it('is there even when institutional sign-in is off, because identities may exist', () => {
      render(<AccountClient user={user} oidcAvailable={false} oidcLabel={null} />);

      expect(screen.getByRole('tab', { name: /connected accounts/i })).toBeInTheDocument();
    });

    it('is there once it is configured', () => {
      render(<AccountClient user={user} oidcAvailable oidcLabel="Penn State" />);

      expect(screen.getByRole('tab', { name: /connected accounts/i })).toBeInTheDocument();
    });
  });

  /**
   * The wiring these tests exist for. It used to be proved through the Navbar's password
   * dialog; the dialog is gone, so it is proved here instead. Without it, the page could
   * render a password form attached to nothing and every test would still pass.
   */
  describe('the password form is connected to the real API', () => {
    it('posts the change and refreshes the session', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);

      const person = userEvent.setup();
      render(<AccountClient user={user} oidcAvailable={false} oidcLabel={null} />);
      // Tab panels mount on demand, so the password form does not exist until its tab opens.
      await person.click(screen.getByRole('tab', { name: /password/i }));
      await waitFor(() => expect(capturedOnChangePassword).toBeTypeOf('function'));
      await capturedOnChangePassword!('OldPass1!', 'NewPass1!');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/me/password',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
        oldPassword: 'OldPass1!',
        newPassword: 'NewPass1!',
      });
      expect(updateMock).toHaveBeenCalledWith({ refreshCredentials: true });
    });

    it('rejects with the server error and does not refresh the session', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({ error: 'Old password is incorrect' }),
        }),
      );

      const person = userEvent.setup();
      render(<AccountClient user={user} oidcAvailable={false} oidcLabel={null} />);
      await person.click(screen.getByRole('tab', { name: /password/i }));
      await waitFor(() => expect(capturedOnChangePassword).toBeTypeOf('function'));

      await expect(capturedOnChangePassword!('x', 'y')).rejects.toThrow(
        'Old password is incorrect',
      );
      expect(updateMock).not.toHaveBeenCalled();
    });
  });
});
