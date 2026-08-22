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

import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
const toastError = toastMock.error;

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

    // The POST specifically. The dialog also looks up whether an LMS has already made an
    // account for this name, and that lookup is debounced, so which request lands first depends
    // on how loaded the machine is. Counting calls made this test pass or fail on timing.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'POST'),
      ).toBe(true),
    );
    const [, requestInit] = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === 'POST',
    ) as [string, RequestInit];
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

/**
 * The warning that an LMS has already made this person an account.
 *
 * The tick is off by default and the account is named in full, because two people can share a
 * name: the whole design is that an administrator reads which account it is and decides, rather
 * than anything being matched for them.
 */
describe('adopting an account an LMS made', () => {
  const ORPHAN = {
    userId: 'u-orphan',
    email: 'bruce@lms.test',
    identityId: 'li-1',
    issuer: 'https://canvas.test',
    connectedAt: '2026-08-14T10:00:00.000Z',
  };

  /** Answers the lookup with an account, and everything else as a successful create. */
  const respond = (account: unknown) =>
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('launch-account')
        ? { ok: true, json: async () => ({ account }) }
        : { ok: true, json: async () => ({ id: 'user-1' }) },
    );

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('says nothing when no account matches', async () => {
    respond(null);
    const user = userEvent.setup();
    render(<CreateUserDialog open setOpen={vi.fn()} onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText('First Name'), 'Ada');
    await user.type(screen.getByLabelText('Last Name'), 'Lovelace');

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('launch-account'))).toBe(true),
    );
    expect(screen.queryByText(/already signed in from an LMS/)).not.toBeInTheDocument();
  });

  it('names the account and leaves the choice untaken', async () => {
    respond(ORPHAN);
    const user = userEvent.setup();
    render(<CreateUserDialog open setOpen={vi.fn()} onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText('First Name'), 'Bruce');
    await user.type(screen.getByLabelText('Last Name'), 'Wayne');

    expect(await screen.findByText(/already signed in from an LMS/)).toBeInTheDocument();
    // The address is what an administrator judges "is this the same person" on. It appears
    // twice on purpose: once naming the account, once in the checkbox saying what will be
    // retired, so ticking the box cannot be done without reading which account it is.
    expect(screen.getAllByText(/bruce@lms.test/).length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('sends nothing about the account unless the box is ticked', async () => {
    respond(ORPHAN);
    const user = userEvent.setup();
    render(<CreateUserDialog open setOpen={vi.fn()} onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText('First Name'), 'Bruce');
    await user.type(screen.getByLabelText('Last Name'), 'Wayne');
    await screen.findByText(/already signed in from an LMS/);
    await user.type(screen.getByLabelText('Email'), 'bruce.wayne@example.edu');
    await user.type(screen.getByLabelText('Password'), 'StrongPass1!');
    await user.type(screen.getByLabelText('Confirm Password'), 'StrongPass1!');
    const submit = screen.getByRole('button', { name: 'Create User' }) as HTMLButtonElement;
    submit.disabled = false;
    await user.click(submit);

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(post).toBeDefined();
    expect(JSON.parse((post![1] as RequestInit).body as string)).not.toHaveProperty(
      'adoptLaunchAccountId',
    );
  });

  it('sends the account id once the box is ticked', async () => {
    respond(ORPHAN);
    const user = userEvent.setup();
    render(<CreateUserDialog open setOpen={vi.fn()} onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText('First Name'), 'Bruce');
    await user.type(screen.getByLabelText('Last Name'), 'Wayne');
    await screen.findByText(/already signed in from an LMS/);
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByLabelText('Email'), 'bruce.wayne@example.edu');
    await user.type(screen.getByLabelText('Password'), 'StrongPass1!');
    await user.type(screen.getByLabelText('Confirm Password'), 'StrongPass1!');
    const submit = screen.getByRole('button', { name: 'Create User' }) as HTMLButtonElement;
    submit.disabled = false;
    await user.click(submit);

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(JSON.parse((post![1] as RequestInit).body as string)).toMatchObject({
      adoptLaunchAccountId: 'u-orphan',
    });
  });
});
