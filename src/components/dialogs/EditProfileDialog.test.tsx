/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EditProfileDialog } from './EditProfileDialog';

const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);
vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));

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

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/hooks/useMaxUploadSize', () => ({
  useMaxUploadSize: () => {
    // Mock the hook but don't call fetch in the hook
    return { maxMb: 25, loading: false, error: null };
  },
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const user = {
  id: 'user-1',
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  avatar: null,
  timezone: 'UTC',
} as any;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

describe('EditProfileDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('updates profile fields and notifies parent', async () => {
    const userEvents = userEvent.setup();
    const setOpen = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockImplementation((_url: string) => {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          firstName: 'Ada',
          lastName: 'Lovelace',
          avatar: null,
          timezone: 'UTC',
        }),
      } as Response);
    });

    renderWithClient(<EditProfileDialog user={user} open setOpen={setOpen} onSave={onSave} />);

    await userEvents.clear(screen.getByLabelText('First Name'));
    await userEvents.type(screen.getByLabelText('First Name'), 'Ada');
    await userEvents.clear(screen.getByLabelText('Last Name'));
    await userEvents.type(screen.getByLabelText('Last Name'), 'Lovelace');

    await userEvents.click(screen.getByRole('button', { name: 'Save Changes' }));

    // Expect 1 call for saving profile (useMaxUploadSize is mocked and doesn't fetch)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Check the profile save call (the only call)
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const formData = requestInit.body as FormData;
    const payload: Record<string, FormDataEntryValue> = {};
    formData.forEach((value, key) => {
      payload[key] = value;
    });

    expect(payload).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(onSave).toHaveBeenCalledWith({
      firstName: 'Ada',
      lastName: 'Lovelace',
      avatar: null,
      timezone: 'UTC',
    });
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalledWith('Profile updated!');
  });

  it('clears the timezone override when Automatic is chosen', async () => {
    const userEvents = userEvent.setup();
    const setOpen = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ firstName: 'Test', lastName: 'User', avatar: null, timezone: null }),
    } as Response);

    const zonedUser = { ...user, timezone: 'America/New_York' };
    renderWithClient(<EditProfileDialog user={zonedUser} open setOpen={setOpen} onSave={onSave} />);

    await userEvents.click(
      screen.getByRole('button', { name: 'Automatic (detect from browser)' }),
    );
    await userEvents.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const formData = requestInit.body as FormData;
    // Blank timezone is what tells the server to clear the override.
    expect(formData.get('timezone')).toBe('');
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: undefined }),
    );
  });
});
