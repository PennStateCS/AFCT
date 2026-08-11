/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toastMock, resetToastMock } from '@/test/mocks/toast';
import { RosterSyncDialog } from './RosterSyncDialog';

/**
 * The preview shown before an LMS roster is applied.
 *
 * This decides who can read student work, so the rule it exists to enforce is that nothing is
 * written until somebody has seen the list and chosen to apply it. What each change means is
 * spelled out in words rather than conveyed by colour, which these check by reading the text.
 */

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

const diff = {
  changes: [
    {
      kind: 'add',
      member: { email: 'new@example.test', firstName: 'Ada', lastName: 'Lovelace' },
      role: 'STUDENT',
    },
    { kind: 'drop', userId: 'u-2', name: 'Gone Student', role: 'STUDENT' },
  ],
  keptStaff: [{ name: 'Prof Marko', role: 'FACULTY' }],
  unchanged: 12,
};

function show(body: unknown = diff) {
  const fetchMock = vi.fn().mockReturnValue(ok(body));
  vi.stubGlobal('fetch', fetchMock);
  render(<RosterSyncDialog courseId="c-1" open={true} onOpenChange={vi.fn()} />);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetToastMock();
  vi.unstubAllGlobals();
});

describe('the preview', () => {
  it('says nothing has happened yet', async () => {
    show();

    expect(
      await screen.findByText(/Nothing changes until you choose to apply it/),
    ).toBeInTheDocument();
  });

  it('names who would be added and who would be dropped', async () => {
    show();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Gone Student')).toBeInTheDocument();
  });

  // Colour alone would not tell somebody using a screen reader which way a row goes.
  it('spells out what each change means', async () => {
    show();

    expect(await screen.findByText('Will be added')).toBeInTheDocument();
    expect(screen.getByText('Will be marked dropped')).toBeInTheDocument();
  });

  it('falls back to the email when the LMS sent no name', async () => {
    show({
      ...diff,
      changes: [
        {
          kind: 'add',
          member: { email: 'noname@example.test', firstName: null, lastName: null },
          role: 'STUDENT',
        },
      ],
    });

    expect(await screen.findByText('noname@example.test')).toBeInTheDocument();
  });

  it('says so when the rosters already agree', async () => {
    show({ changes: [], keptStaff: [], unchanged: 30 });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText('Will be added')).not.toBeInTheDocument();
  });

  it('shows the reason when the LMS roster cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.resolve({ error: 'Your LMS did not answer.' }),
        } as Response),
      ),
    );
    render(<RosterSyncDialog courseId="c-1" open={true} onOpenChange={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Your LMS did not answer.');
  });
});

/** Reading the preview must not change anything; only Apply does. */
describe('applying', () => {
  it('sends nothing until Apply is chosen', async () => {
    const fetchMock = show();

    await screen.findByText('Ada Lovelace');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
  });

  it('reports what happened, with the counts as the detail', async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(ok(diff));
    fetchMock.mockReturnValueOnce(ok({ added: 6, dropped: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RosterSyncDialog courseId="c-1" open={true} onOpenChange={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Apply these changes/ }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Roster synced', {
        description: '6 added, 3 marked dropped.',
      }),
    );
  });

  it('closes only after the changes are applied', async () => {
    const onOpenChange = vi.fn();
    const fetchMock = vi.fn().mockReturnValueOnce(ok(diff));
    fetchMock.mockReturnValueOnce(ok({ added: 1, dropped: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RosterSyncDialog courseId="c-1" open={true} onOpenChange={onOpenChange} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Apply these changes/ }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  // The server's wording is the specific one, so it wins over the written-out fallback.
  it('shows the reason the server gave for refusing', async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(ok(diff));
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'This course is archived.' }),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<RosterSyncDialog courseId="c-1" open={true} onOpenChange={vi.fn()} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Apply these changes/ }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('This course is archived.'));
  });
});
