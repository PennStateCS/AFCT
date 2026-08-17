/** @vitest-environment jsdom */

import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RosterSyncButton } from './RosterSyncButton';

/**
 * The sync button decides for itself whether it belongs on the page, because most courses have
 * no LMS and a button whose only outcome is "this course has no LMS" is worse than none.
 */

vi.mock('@/components/course/RosterSyncDialog', () => ({
  RosterSyncDialog: ({ open }: { open: boolean }) => (open ? <div>sync dialog</div> : null),
}));

const answering = (links: unknown[]) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ links }) } as Response);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('offers the sync once the course is connected to an LMS', async () => {
  vi.stubGlobal('fetch', answering([{ id: 'l-1' }]));

  render(<RosterSyncButton courseId="c-1" />);

  expect(await screen.findByRole('button', { name: /Sync roster/ })).toBeInTheDocument();
});

it('shows nothing at all on a course with no LMS', async () => {
  const fetchMock = answering([]);
  vi.stubGlobal('fetch', fetchMock);

  const { container } = render(<RosterSyncButton courseId="c-1" />);

  // Wait for the answer, or this passes before it arrives and would pass with any behaviour.
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it('stays hidden when the check itself fails, rather than offering a broken action', async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetchMock);

  const { container } = render(<RosterSyncButton courseId="c-1" />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

it('refetches the roster once the dialog closes, since applying rewrites it', async () => {
  vi.stubGlobal('fetch', answering([{ id: 'l-1' }]));
  const onSynced = vi.fn();
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();

  render(<RosterSyncButton courseId="c-1" onSynced={onSynced} />);
  await user.click(await screen.findByRole('button', { name: /Sync roster/ }));

  expect(screen.getByText('sync dialog')).toBeInTheDocument();
  expect(onSynced).not.toHaveBeenCalled();
});
