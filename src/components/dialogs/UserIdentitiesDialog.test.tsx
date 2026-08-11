/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserIdentitiesDialog } from './UserIdentitiesDialog';

/**
 * What an administrator sees when asking how somebody signs in.
 *
 * jsdom does no layout, so these prove wiring and the one rule that matters: an account with no
 * password and a single connected method must not be able to have it detached, because that
 * leaves a person locked out of a system they are enrolled in. The route enforces it too; a
 * disabled button is the difference between a refusal and a dead end.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: toast }));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC', hour12: false }),
}));

const identity = {
  id: 'li-1',
  kind: 'OIDC',
  issuer: 'https://idp.example.test',
  subject: 'sub-1',
  linkedVia: 'SELF_SERVICE',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSignInAt: null,
};

const respond = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 409, json: () => Promise.resolve(body) } as Response);

/** The dialog loads on open, so every case starts from a stubbed GET. */
function show(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockReturnValue(respond(body, ok));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <UserIdentitiesDialog userId="u-1" userName="Ada Lovelace" open={true} setOpen={vi.fn()} />,
  );
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('what it shows', () => {
  it('names the person in the title', async () => {
    show({ identities: [], hasPassword: true });

    expect(await screen.findByText('How Ada Lovelace signs in')).toBeInTheDocument();
  });

  it('lists a connected method in words rather than code names', async () => {
    show({ identities: [identity], hasPassword: true });

    expect(await screen.findByText('Institutional sign-in')).toBeInTheDocument();
    expect(screen.getByText(/They connected it themselves/)).toBeInTheDocument();
  });

  it('says so when a method has never been used', async () => {
    show({ identities: [identity], hasPassword: true });

    expect(await screen.findByText('Never used to sign in')).toBeInTheDocument();
  });

  it('says nothing is connected when the list is empty', async () => {
    show({ identities: [], hasPassword: true });

    expect(await screen.findByText(/Nothing is connected/)).toBeInTheDocument();
  });

  // Whether an AFCT password exists changes what detaching one of these would mean.
  it('tells an administrator there is no password to fall back on', async () => {
    show({ identities: [identity, { ...identity, id: 'li-2' }], hasPassword: false });

    expect(await screen.findByText(/no AFCT password/)).toBeInTheDocument();
  });

  it('reports a failed load rather than showing an empty list as fact', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(
      <UserIdentitiesDialog userId="u-1" userName="Ada Lovelace" open={true} setOpen={vi.fn()} />,
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

/**
 * The lockout guard. Detaching the last way in, for somebody with no password, would leave
 * them unable to reach their own coursework.
 */
describe('the last way in', () => {
  it('cannot be detached when there is no password', async () => {
    show({ identities: [identity], hasPassword: false });

    expect(await screen.findByRole('button', { name: /Detach/ })).toBeDisabled();
    expect(screen.getByText(/only way they can sign in/)).toBeInTheDocument();
  });

  it('can be detached when a password exists', async () => {
    show({ identities: [identity], hasPassword: true });

    expect(await screen.findByRole('button', { name: /Detach/ })).toBeEnabled();
  });

  // Two methods means removing one still leaves a way in, password or not.
  it('can be detached when a second method exists', async () => {
    show({ identities: [identity, { ...identity, id: 'li-2' }], hasPassword: false });

    const buttons = await screen.findAllByRole('button', { name: /Detach/ });
    expect(buttons[0]).toBeEnabled();
  });
});

describe('detaching', () => {
  it('asks the server to remove that identity, then reloads', async () => {
    const fetchMock = show({ identities: [identity], hasPassword: true });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Detach/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sign-in method detached.'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/users/u-1/identities?identityId=li-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    // Reloaded, so the list reflects the server rather than a local guess.
    expect(fetchMock.mock.calls.filter((c) => c[1] === undefined)).toHaveLength(2);
  });

  // The route refuses in cases the dialog cannot see, so its message is the useful one.
  it('shows the reason the server gave for refusing', async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(respond({ identities: [identity], hasPassword: true }));
    fetchMock.mockReturnValueOnce(respond({ error: 'That is their only way in.' }, false));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <UserIdentitiesDialog userId="u-1" userName="Ada Lovelace" open={true} setOpen={vi.fn()} />,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Detach/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That is their only way in.'));
  });
});
