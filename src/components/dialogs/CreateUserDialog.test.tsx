/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CreateUserDialog } from './CreateUserDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);
vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: {
    error: toastError,
  },
}));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

describe('CreateUserDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    toastError.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const fillForm = async () => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First Name'), 'Ada');
    await user.type(screen.getByLabelText('Last Name'), 'Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'StrongPass1!');
    await user.type(screen.getByLabelText('Confirm Password'), 'StrongPass1!');
    const submitButton = screen.getByRole('button', { name: 'Create User' }) as HTMLButtonElement;
    submitButton.disabled = false;
    await user.click(submitButton);
  };

  it('creates a user and closes the dialog', async () => {
    const onSuccess = vi.fn();
    const setOpen = vi.fn();

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'user-1' }) } as Response);

    render(<CreateUserDialog open setOpen={setOpen} onSuccess={onSuccess} />);

    await fillForm();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(requestInit.body as string)).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });

    expect(onSuccess).toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('reports API validation errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ error: 'Nope' }),
    } as Response);

    render(<CreateUserDialog open setOpen={vi.fn()} onSuccess={vi.fn()} />);

    await fillForm();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Nope'));
  });
});
