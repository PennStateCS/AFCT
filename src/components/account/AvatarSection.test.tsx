/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AvatarSection } from './AvatarSection';

// The crop editor is drag/pointer-driven and irrelevant to these save tests; stub it.
vi.mock('@/components/AvatarCrop', () => ({ AvatarCrop: () => null }));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { updateSession } = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated', update: updateSession }),
}));

import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

const user = {
  id: 'user-1',
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  avatar: 'pic.png',
  timezone: 'UTC',
} as never;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const sentFields = () => {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const payload: Record<string, FormDataEntryValue> = {};
  (init.body as FormData).forEach((value, key) => {
    payload[key] = value;
  });
  return payload;
};

describe('AvatarSection', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    updateSession.mockReset();
    refresh.mockReset();
    toastMock.updated.mockReset();
    toastMock.error.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('has nothing to save until something changes', () => {
    render(<AvatarSection user={user} />);

    expect(screen.getByRole('button', { name: 'Save photo' })).toBeDisabled();
  });

  it('sends deleteAvatar and no file when the photo is removed', async () => {
    const userEvents = userEvent.setup();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    render(<AvatarSection user={user} />);

    await userEvents.click(screen.getByRole('button', { name: /Delete Avatar/i }));
    await userEvents.click(screen.getByRole('button', { name: 'Save photo' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = sentFields();
    expect(payload.deleteAvatar).toBe('true');
    expect(payload.avatar).toBeUndefined();
    // The session carries the avatar for the sidebar, and the page reads the user from it
    // on the server, so both are refreshed.
    expect(updateSession).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('says nothing about the name or the timezone', async () => {
    // They are saved from the Profile tab. Sending them from here would write back whatever
    // this page was holding rather than what is stored.
    const userEvents = userEvent.setup();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    render(<AvatarSection user={user} />);

    await userEvents.click(screen.getByRole('button', { name: /Delete Avatar/i }));
    await userEvents.click(screen.getByRole('button', { name: 'Save photo' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = sentFields();
    expect(payload.firstName).toBeUndefined();
    expect(payload.lastName).toBeUndefined();
    expect(payload.timezone).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual(['cropX', 'cropY', 'deleteAvatar', 'zoom']);
  });

  it('keeps the change and does not refresh anything when the save fails', async () => {
    const userEvents = userEvent.setup();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) } as Response);

    render(<AvatarSection user={user} />);

    await userEvents.click(screen.getByRole('button', { name: /Delete Avatar/i }));
    await userEvents.click(screen.getByRole('button', { name: 'Save photo' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Could not save your photo. Check your connection and try again.',
      ),
    );
    expect(updateSession).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // Still removed on screen, so the save can be tried again.
    expect(screen.getByRole('button', { name: 'Save photo' })).toBeEnabled();
  });

  it('refuses a file that is not an image', async () => {
    // fireEvent rather than userEvent.upload, which honours the input's `accept` and so would
    // never hand the component the file. The picker filters, but "All files" is one click away
    // in the OS dialog, so the check has to be here too.
    const { container } = render(
      <AvatarSection user={{ ...(user as object), avatar: null } as never} />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(['not a picture'], 'notes.txt', { type: 'text/plain' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Avatar must be an image.');
    expect(screen.getByRole('button', { name: 'Save photo' })).toBeDisabled();
  });
});
