/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';

/**
 * The admin account actions: deactivate, reactivate, unlock and delete.
 *
 * These live in a separate file from `user-columns.test.tsx` because they need the opposite
 * mocks. That file stubs the menu items into inert divs and `ConfirmDialog` into null, which
 * is right for asserting what a row *displays*; here the items have to be clickable and the
 * confirm has to fire, so the handler behind it actually runs.
 *
 * Each action is pinned twice: the request it sends, and what happens when the server says
 * no. The refusal path matters most - the route blocks deactivating the last active admin
 * and deleting a user who is still on a live course, and the only thing that tells the
 * operator why is the message surfaced here.
 */

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

// Clickable menu items, unlike the display-only sibling file.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({
      children,
      onClick,
      disabled,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

// A real confirm is a portalled Radix alert dialog; render it as a button so the
// confirm handler is reachable.
vi.mock('@/components/dialogs/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    confirmText,
  }: {
    open: boolean;
    onConfirm: () => void | Promise<void>;
    confirmText?: string;
  }) =>
    open ? (
      <button type="button" onClick={() => void onConfirm()}>
        {confirmText}
      </button>
    ) : null,
}));

vi.mock('@/components/dialogs/EditUserDialog', () => ({ EditUserDialog: () => null }));
vi.mock('@/components/dialogs/ResetPasswordDialog', () => ({ ResetPasswordDialog: () => null }));
vi.mock('@/components/dialogs/ChangeUserEmailDialog', () => ({
  ChangeUserEmailDialog: () => null,
}));

import { getUserColumns } from './user-columns';
import { toastMock } from '@/test/mocks/toast';

const baseUser = {
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  avatar: null,
  isAdmin: false,
  inactive: false,
  temporaryPassword: false,
  lockedUntil: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLogin: null,
};

const okJson = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body }) as Response;
const errJson = (status: number, body: unknown) =>
  ({ ok: false, status, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

/** Render the Manage cell for a user, click a menu item, then confirm the dialog. */
async function act(user: Record<string, unknown>, itemName: RegExp, confirmName: RegExp) {
  const onUserUpdate = vi.fn();
  const cols = getUserColumns(onUserUpdate, 'UTC') as ColumnDef<Record<string, unknown>>[];
  const col = cols.find((c) => (c as { id?: string }).id === 'actions') as {
    cell: (ctx: unknown) => React.ReactElement;
  };
  const person = userEvent.setup();
  render(<>{col.cell({ row: { original: user, getValue: (k: string) => user[k] } })}</>);

  await person.click(screen.getByRole('button', { name: itemName }));
  await person.click(await screen.findByRole('button', { name: confirmName }));
  return { onUserUpdate };
}

describe('admin account actions', () => {
  describe('deactivating and reactivating', () => {
    it('deactivates an active account', async () => {
      fetchMock.mockResolvedValue(okJson());

      const { onUserUpdate } = await act(baseUser, /^Deactivate/, /^Deactivate account$/);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/users/u1');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ inactive: true });
      await waitFor(() => expect(onUserUpdate).toHaveBeenCalled());
      expect(toastMock.success).toHaveBeenCalledWith('Account deactivated');
    });

    it('reactivates an inactive account', async () => {
      fetchMock.mockResolvedValue(okJson());

      await act({ ...baseUser, inactive: true }, /^Reactivate/, /^Reactivate account$/);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ inactive: false });
      expect(toastMock.success).toHaveBeenCalledWith('Account reactivated');
    });

    it('surfaces the route refusal rather than reporting success', async () => {
      // e.g. the last active admin, or a user still on a live course.
      fetchMock.mockResolvedValue(errJson(409, { error: 'Cannot deactivate the last admin' }));

      const { onUserUpdate } = await act(baseUser, /^Deactivate/, /^Deactivate account$/);

      await waitFor(() =>
        expect(toastMock.error).toHaveBeenCalledWith('Cannot deactivate the last admin'),
      );
      expect(toastMock.success).not.toHaveBeenCalled();
      expect(onUserUpdate).not.toHaveBeenCalled();
    });

    it('falls back to a generic message when the refusal carries no reason', async () => {
      fetchMock.mockResolvedValue(errJson(500, {}));

      await act(baseUser, /^Deactivate/, /^Deactivate account$/);

      await waitFor(() =>
        expect(toastMock.error).toHaveBeenCalledWith('Failed to update account status.'),
      );
    });
  });

  describe('unlocking', () => {
    const locked = { ...baseUser, lockedUntil: new Date(Date.now() + 3_600_000).toISOString() };

    it('unlocks a locked account', async () => {
      fetchMock.mockResolvedValue(okJson());

      const { onUserUpdate } = await act(locked, /^Unlock/, /^Unlock account$/);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/admin/unlock-account');
      expect(JSON.parse(init.body as string)).toEqual({ userId: 'u1' });
      await waitFor(() => expect(onUserUpdate).toHaveBeenCalled());
      expect(toastMock.success).toHaveBeenCalledWith('Account unlocked');
    });

    it('reports why an unlock failed', async () => {
      fetchMock.mockResolvedValue(errJson(400, { error: 'Account is not locked' }));

      const { onUserUpdate } = await act(locked, /^Unlock/, /^Unlock account$/);

      await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Account is not locked'));
      expect(onUserUpdate).not.toHaveBeenCalled();
    });
  });

  describe('deleting', () => {
    // Deletion is only offered once the account is already deactivated, so every case
    // here starts from an inactive user.
    const inactive = { ...baseUser, inactive: true };

    it('is not offered for an account that is still active', async () => {
      const cols = getUserColumns(vi.fn(), 'UTC') as ColumnDef<Record<string, unknown>>[];
      const col = cols.find((c) => (c as { id?: string }).id === 'actions') as {
        cell: (ctx: unknown) => React.ReactElement;
      };
      render(<>{col.cell({ row: { original: baseUser, getValue: (k: string) => baseUser[k as keyof typeof baseUser] } })}</>);

      expect(screen.getByRole('button', { name: /^Delete Inactive User/ })).toBeDisabled();
    });

    it('deletes the account and reports it by name', async () => {
      fetchMock.mockResolvedValue(okJson());

      const { onUserUpdate } = await act(inactive, /^Delete Inactive User/, /^Delete user$/);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/users/u1');
      expect(init.method).toBe('DELETE');
      await waitFor(() => expect(onUserUpdate).toHaveBeenCalled());
      expect(toastMock.deleted).toHaveBeenCalledWith('User', { name: 'Ada Lovelace' });
    });

    it('surfaces the route refusal and leaves the row alone', async () => {
      fetchMock.mockResolvedValue(errJson(409, { error: 'User is enrolled in a live course' }));

      const { onUserUpdate } = await act(inactive, /^Delete Inactive User/, /^Delete user$/);

      await waitFor(() =>
        expect(toastMock.error).toHaveBeenCalledWith('User is enrolled in a live course'),
      );
      expect(onUserUpdate).not.toHaveBeenCalled();
    });

    it('reports a network failure rather than failing silently', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));

      const { onUserUpdate } = await act(inactive, /^Delete Inactive User/, /^Delete user$/);

      await waitFor(() =>
        expect(toastMock.error).toHaveBeenCalledWith(
          'Could not delete the user. Check your connection and try again.',
        ),
      );
      expect(onUserUpdate).not.toHaveBeenCalled();
    });
  });
});
