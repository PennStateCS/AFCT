// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * The forced first-login password change. The regression this guards: a successful
 * change must refresh the JWT (`update({ refreshCredentials: true })`) BEFORE navigating,
 * otherwise the token still snapshots the old password, the session callback revokes it,
 * and the user is bounced straight back to this screen (the bug faculty hit on the test
 * build).
 */

const updateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock('next-auth/react', () => ({ useSession: () => ({ update: updateMock }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/toast', () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));

import { ForcedPasswordChangeForm } from './ForcedPasswordChangeForm';

const setInput = (name: string, value: string) => {
  const el = document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  fireEvent.change(el, { target: { value } });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
  );
});

describe('ForcedPasswordChangeForm', () => {
  it('refreshes the session before sending the user to the dashboard', async () => {
    render(<ForcedPasswordChangeForm />);

    setInput('oldPassword', 'TempPass1!');
    setInput('newPassword', 'NewP@ssw0rd!');
    setInput('confirmNewPassword', 'NewP@ssw0rd!');

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ refreshCredentials: true }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));

    // The token refresh must land before navigation, or the dashboard's first request
    // still sees the pre-change token and revokes it.
    expect(updateMock.mock.invocationCallOrder[0]).toBeLessThan(
      pushMock.mock.invocationCallOrder[0],
    );
  });

  it('does not refresh or navigate when the change is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Incorrect old password' }),
      }),
    );

    render(<ForcedPasswordChangeForm />);
    setInput('oldPassword', 'WrongPass1!');
    setInput('newPassword', 'NewP@ssw0rd!');
    setInput('confirmNewPassword', 'NewP@ssw0rd!');

    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => expect(screen.getByText('Incorrect old password')).toBeInTheDocument());
    expect(updateMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
