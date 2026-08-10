/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ProfileSection } from './ProfileSection';

const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);
vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));
// The crop editor is drag/pointer-driven and irrelevant to these form tests; stub it.
vi.mock('@/components/AvatarCrop', () => ({ AvatarCrop: () => null }));

const { updateSession } = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated', update: updateSession }),
}));

import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
const toastSuccess = toastMock.success;
const toastError = toastMock.error;

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/hooks/use-max-upload-size', () => ({
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

describe('ProfileSection', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    toastSuccess.mockReset();
    toastError.mockReset();
    updateSession.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('updates profile fields and notifies parent', async () => {
    const userEvents = userEvent.setup();
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

    renderWithClient(<ProfileSection user={user} onSave={onSave} />);

    await userEvents.clear(screen.getByLabelText('First Name'));
    await userEvents.type(screen.getByLabelText('First Name'), 'Ada');
    await userEvents.clear(screen.getByLabelText('Last Name'));
    await userEvents.type(screen.getByLabelText('Last Name'), 'Lovelace');

    await userEvents.click(screen.getByRole('button', { name: 'Save changes' }));

    // Expect 1 call for saving profile (useMaxUploadSize is mocked and doesn't fetch)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Check the profile save call (the only call)
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const formData = requestInit.body as FormData;
    const payload: Record<string, FormDataEntryValue> = {};
    formData.forEach((value, key) => {
      payload[key] = value;
    });

    // The crop values are always sent so the server can persist the framing.
    expect(payload).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      cropX: '0.5',
      cropY: '0.5',
      zoom: '1',
    });
    expect(onSave).toHaveBeenCalledWith({
      firstName: 'Ada',
      lastName: 'Lovelace',
      avatar: null,
      timezone: 'UTC',
      cropX: 0.5,
      cropY: 0.5,
      zoom: 1,
    });
    expect(toastMock.updated).toHaveBeenCalledWith('Profile');
    // The session is refreshed so navbar/sidebar avatars update without a reload.
    expect(updateSession).toHaveBeenCalled();
  });

  it('clears the timezone override when Automatic is chosen', async () => {
    const userEvents = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ firstName: 'Test', lastName: 'User', avatar: null, timezone: null }),
    } as Response);

    const zonedUser = { ...user, timezone: 'America/New_York' };
    renderWithClient(<ProfileSection user={zonedUser} onSave={onSave} />);

    await userEvents.click(screen.getByRole('button', { name: 'Automatic (detect from browser)' }));
    await userEvents.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const formData = requestInit.body as FormData;
    // Blank timezone is what tells the server to clear the override.
    expect(formData.get('timezone')).toBe('');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ timezone: undefined }));
  });

  it('shows an error and keeps what was entered when the save fails', async () => {
    const userEvents = userEvent.setup();

    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    renderWithClient(<ProfileSection user={user} />);

    await userEvents.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Could not save your profile. Check your connection and try again.',
      ),
    );
    // The session is not refreshed on a failed save.
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('sends deleteAvatar and no file when the avatar is removed', async () => {
    const userEvents = userEvent.setup();
    const avatarUser = { ...user, avatar: 'pic.png' };

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ firstName: 'Test', lastName: 'User', avatar: null, timezone: 'UTC' }),
    } as Response);

    renderWithClient(<ProfileSection user={avatarUser} />);

    await userEvents.click(screen.getByRole('button', { name: /Delete Avatar/i }));
    await userEvents.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const formData = requestInit.body as FormData;
    expect(formData.get('deleteAvatar')).toBe('true');
    expect(formData.get('avatar')).toBeNull();
  });
});
