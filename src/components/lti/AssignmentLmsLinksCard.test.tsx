/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toastMock, resetToastMock } from '@/test/mocks/toast';
import { AssignmentLmsLinksCard, type AssignmentLmsLink } from './AssignmentLmsLinksCard';

/**
 * The card that lists where an assignment appears in an LMS and takes a record back.
 *
 * The behaviour worth guarding is that removal is bookkeeping: it must call the right endpoint,
 * report the removal upward so the header badge follows, and never claim to have changed the
 * LMS. A staff member who believes "remove" deleted the LMS activity leaves a live link behind.
 */

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC', hour12: false }),
}));

const link: AssignmentLmsLink = {
  id: 'link-1',
  platform: 'Canvas',
  context: 'CMPSC 464 Fall 2026',
  addedAt: '2026-08-18T14:00:00.000Z',
  addedBy: 'Ada Lovelace',
};

function show(links: AssignmentLmsLink[], onRemoved = vi.fn(), archived = false) {
  render(
    <AssignmentLmsLinksCard
      courseId="c-1"
      assignmentId="a-1"
      links={links}
      loading={false}
      courseIsArchived={archived}
      onRemoved={onRemoved}
    />,
  );
  return onRemoved;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetToastMock();
  vi.unstubAllGlobals();
});

describe('an assignment no LMS opens', () => {
  it('says where to add it rather than showing an empty list', () => {
    show([]);

    expect(screen.getByText(/has not been added to a course in your LMS/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

describe('an assignment an LMS opens', () => {
  it('names the LMS course and who added it', () => {
    show([link]);

    expect(screen.getByText('CMPSC 464 Fall 2026 in Canvas')).toBeInTheDocument();
    expect(screen.getByText(/by Ada Lovelace/)).toBeInTheDocument();
  });

  it('names the LMS alone when the launch gave no course title', () => {
    show([{ ...link, context: null }]);

    expect(screen.getByText('Canvas')).toBeInTheDocument();
  });

  it('says the LMS link keeps working, which is the thing people get wrong', async () => {
    show([link]);

    expect(screen.getByText(/keeps working until you delete it there/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/Nothing changes in your LMS/)).toBeInTheDocument();
  });

  it('removes the record and tells its owner, so the badge can follow', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const onRemoved = show([link]);

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove link' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c-1/assignments/a-1/lti-links/link-1', {
        method: 'DELETE',
      }),
    );
    expect(onRemoved).toHaveBeenCalledWith('link-1');
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('keeps the link when the request fails, and says so', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const onRemoved = show([link]);

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove link' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('offers no removal on an archived course, which the server also refuses', () => {
    show([link], vi.fn(), true);

    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});
