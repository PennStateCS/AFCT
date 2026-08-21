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

/**
 * The component asks the server which form to show before showing one, so every test has to
 * answer that first. The three answers are the three states.
 */
const capability = (body: { hasPassword: boolean; canSetPassword: boolean }) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

/** Render, then wait for the capability read to settle into a form. */
const renderSection = async (
  props: { onChangePassword: (o: string | null, n: string) => Promise<void> },
  state: { hasPassword: boolean; canSetPassword: boolean } = {
    hasPassword: true,
    canSetPassword: false,
  },
) => {
  capability(state);
  render(<PasswordSection {...props} />);
  await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
};

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

    await renderSection({ onChangePassword });
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

    await renderSection({ onChangePassword: vi.fn().mockResolvedValue(undefined) });
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''));
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('surfaces an API error and keeps what was typed', async () => {
    const user = userEvent.setup();

    await renderSection({ onChangePassword: vi.fn().mockRejectedValue(new Error('Nope')) });
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Nope'));
    // Losing the entry on failure would mean retyping all three for a server-side hiccup.
    expect(screen.getByLabelText('Current password')).toHaveValue('OldPass1!');
  });

  it('will not submit until something has been entered', async () => {
    await renderSection({ onChangePassword: vi.fn() });

    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
  });

  /**
   * The three states, which are the whole point of the component. An account with no password
   * must never be shown a "Current password" box, because there is no answer to it.
   */
  describe('an account with no password', () => {
    it('offers to set one, with no current-password field', async () => {
      const user = userEvent.setup();
      const onChangePassword = vi.fn().mockResolvedValue(undefined);

      await renderSection({ onChangePassword }, { hasPassword: false, canSetPassword: true });

      expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
      await user.type(screen.getByLabelText('New password'), 'NewPass1!');
      await user.type(screen.getByLabelText('Confirm new password'), 'NewPass1!');
      await user.click(screen.getByRole('button', { name: 'Set password' }));

      // Null rather than an empty string: the endpoint decides from the account, and null is
      // what tells the hook to leave the field out altogether.
      await waitFor(() => expect(onChangePassword).toHaveBeenCalledWith(null, 'NewPass1!'));
      expect(toastSuccess).toHaveBeenCalledWith('Password set');
    });

    it('explains instead when the site does not allow it', async () => {
      await renderSection(
        { onChangePassword: vi.fn() },
        { hasPassword: false, canSetPassword: false },
      );

      expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Set password' })).not.toBeInTheDocument();
      expect(screen.getByText(/administrator can give you one/i)).toBeInTheDocument();
    });
  });

  /**
   * A failed read must not decide policy by itself. Showing the set form would offer a first
   * password to somebody who has one; the change form is the safe guess, and the endpoint
   * refuses anything this gets wrong.
   */
  it('falls back to the change form when the account cannot be read', async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi
      .fn()
      .mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    render(<PasswordSection onChangePassword={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText('Current password')).toBeInTheDocument());
  });
});
