/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { EditUserDialog } from './EditUserDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);
vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { isAdmin: true } }, status: 'authenticated' }),
}));

const { showToastSuccess, showToastError } = vi.hoisted(() => ({
  showToastSuccess: vi.fn(),
  showToastError: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showToast: {
    success: showToastSuccess,
    error: showToastError,
  },
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const baseUser = {
  id: 'user-1',
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  role: 'STUDENT',
  avatar: null,
  timezone: 'UTC',
  inactive: false,
} as any;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

describe('EditUserDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    showToastSuccess.mockReset();
    showToastError.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('saves updated user details', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    } as unknown as Response);

    render(<EditUserDialog user={baseUser} open setOpen={setOpen} onSave={onSave} />);

    await user.clear(screen.getByLabelText('First Name'));
    await user.type(screen.getByLabelText('First Name'), 'Ada');
    await user.clear(screen.getByLabelText('Last Name'));
    await user.type(screen.getByLabelText('Last Name'), 'Lovelace');

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const formData = requestInit.body as FormData;
    const payload: Record<string, FormDataEntryValue> = {};
    formData.forEach((value, key) => {
      payload[key] = value;
    });

    expect(payload).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(onSave).toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(showToastSuccess).toHaveBeenCalledWith('User updated successfully.');
  });
});
