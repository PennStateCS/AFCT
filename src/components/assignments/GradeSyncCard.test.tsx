/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toastMock, resetToastMock } from '@/test/mocks/toast';
import { GradeSyncCard } from './GradeSyncCard';

/**
 * Grade sync for one assignment, in its three placements. The switch saves optimistically and
 * has to roll back on failure, or faculty think grades are going out when they are not.
 */

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC', hour12: false }),
}));

const linked = {
  linked: true,
  autoSync: false,
  pending: 0,
  sent: 0,
  failed: 0,
  lastSentAt: null as string | null,
  student: null as {
    state: 'PENDING' | 'SENT' | 'FAILED';
    sentAt: string | null;
    lastError: string | null;
  } | null,
};

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

function show(state: Partial<typeof linked>, variant: 'settings' | 'status' | 'inline') {
  const fetchMock = vi.fn().mockReturnValue(ok({ ...linked, ...state }));
  vi.stubGlobal('fetch', fetchMock);
  render(<GradeSyncCard assignmentId="a-1" variant={variant} />);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetToastMock();
  vi.unstubAllGlobals();
});

/** A course with no LMS must not be told about one, except where it can be set up. */
describe('a course with no LMS', () => {
  it('explains itself on the settings tab, which is somewhere you navigated to', async () => {
    show({ linked: false }, 'settings');

    // Why it is unavailable, and where the connection is actually made. The old copy opened
    // with the procedure ("once somebody opens AFCT from your LMS and connects the course"),
    // which asks the reader to follow a recipe before learning what the card is for.
    expect(await screen.findByText(/not connected to an LMS course/)).toBeInTheDocument();
    expect(screen.getByText(/opening AFCT from a link in your LMS course/)).toBeInTheDocument();
  });

  /*
   * The heading is the feature's name, not a description of where grades end up. It has to
   * match the panel beside a student's grade, because a professor moves between the two while
   * marking and two names for one thing reads as two features.
   */
  it('calls the card Grade sync, connected or not', async () => {
    show({ linked: false }, 'settings');

    expect(await screen.findByRole('heading', { name: 'Grade sync' })).toBeInTheDocument();
  });

  // It must not claim anything about assignment links: it never asked about them. That is a
  // separate card reading a separate endpoint.
  it('says nothing about assignment links, which it has not read', async () => {
    show({ linked: false }, 'settings');

    await screen.findByRole('heading', { name: 'Grade sync' });
    expect(screen.queryByText(/assignment link/i)).not.toBeInTheDocument();
  });

  it('shows nothing at all next to the grades', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok({ ...linked, linked: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<GradeSyncCard assignmentId="a-1" variant="inline" />);

    // Wait for the load to settle, or this passes before the answer even arrives.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing on the status placement either', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok({ ...linked, linked: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<GradeSyncCard assignmentId="a-1" variant="status" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('what the status says', () => {
  it('leads with failures, since those need somebody to act', async () => {
    show({ failed: 2, pending: 5, sent: 9 }, 'status');

    expect(await screen.findByText(/2 grades could not be sent to the LMS/)).toBeInTheDocument();
  });

  it('counts one failure in the singular', async () => {
    show({ failed: 1 }, 'status');

    expect(await screen.findByText(/^1 grade could not be sent/)).toBeInTheDocument();
  });

  it('reports what is still waiting when nothing has failed', async () => {
    show({ pending: 3, sent: 1 }, 'status');

    expect(await screen.findByText(/3 grades are waiting/)).toBeInTheDocument();
  });

  it('counts one pending grade in the singular', async () => {
    show({ pending: 1 }, 'status');

    expect(await screen.findByText(/^1 grade is waiting/)).toBeInTheDocument();
  });

  it('says everything is sent once nothing is pending', async () => {
    show({ sent: 4 }, 'status');

    expect(await screen.findByText('All grades have been sent to the LMS.')).toBeInTheDocument();
  });

  it('says so before anything has ever been sent', async () => {
    show({}, 'status');

    expect(await screen.findByText('No grades have been sent yet.')).toBeInTheDocument();
  });

  it('shows when grades last went out', async () => {
    show({ sent: 1, lastSentAt: '2026-03-04T15:00:00.000Z' }, 'status');

    expect(await screen.findByText(/Last sent/)).toBeInTheDocument();
  });
});

/**
 * The switch writes as soon as it is flipped, so a failure has to be visible. Otherwise the
 * screen claims grades are syncing automatically when the setting never saved.
 */
describe('the automatic-sync switch', () => {
  /*
   * What the switch promises has to name where grades go, because "automatically" on its own
   * does not say whether that means into AFCT's own gradebook or out to the LMS. It says the
   * connected LMS course rather than "your LMS": grades land in one course's gradebook, and
   * which one is exactly what a professor with two linked sections needs to know.
   */
  it('says where grades go, not just that they go', async () => {
    show({}, 'settings');

    expect(await screen.findByRole('switch', { name: /Send grades automatically/ })).toBeVisible();
    expect(screen.getByText(/connected LMS course/)).toBeInTheDocument();
  });

  it('saves the new setting', async () => {
    const fetchMock = show({}, 'settings');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/assignments/a-1/lti-sync',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ autoSync: true }) }),
      ),
    );
  });

  it('puts itself back and says so when the save fails', async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(ok(linked));
    fetchMock.mockReturnValueOnce(Promise.resolve({ ok: false, status: 500 } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(<GradeSyncCard assignmentId="a-1" variant="settings" />);
    const user = userEvent.setup();

    const toggle = await screen.findByRole('switch');
    await user.click(toggle);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toggle).not.toBeChecked();
  });
});

describe('sending grades now', () => {
  it('reports how many are on their way, then reloads the state', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok(linked));
    fetchMock.mockReturnValueOnce(ok(linked)).mockReturnValueOnce(ok({ queued: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<GradeSyncCard assignmentId="a-1" variant="status" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Send grades now/ }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('3 grades are on their way to the LMS.'),
    );
    // Third call is the reload, so the counts shown are the server's, not a guess.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('says everything was already up to date rather than claiming it sent nothing', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok(linked));
    fetchMock.mockReturnValueOnce(ok(linked)).mockReturnValueOnce(ok({ queued: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<GradeSyncCard assignmentId="a-1" variant="status" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Send grades now/ }));

    // No destination on this one: nothing was sent, so naming the LMS only lengthens it.
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Every grade is already up to date.'),
    );
  });

  it('reports a failure instead of leaving the button spinning', async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(ok(linked));
    fetchMock.mockReturnValueOnce(Promise.resolve({ ok: false, status: 500 } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(<GradeSyncCard assignmentId="a-1" variant="status" />);
    const user = userEvent.setup();

    const button = await screen.findByRole('button', { name: /Send grades now/ });
    await user.click(button);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(button).toBeEnabled();
  });
});

/** Collapsible because it sits above the grade form, but open by default. */
describe('the inline placement', () => {
  it('starts open, since whether grades arrived is worth seeing unasked', async () => {
    show({ sent: 2 }, 'inline');

    expect(await screen.findByRole('button', { name: /Collapse grade sync/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('collapses and expands again', async () => {
    show({ sent: 2 }, 'inline');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Collapse grade sync/ }));

    expect(screen.queryByRole('button', { name: /Send grades now/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Expand grade sync/ }));
    expect(screen.getByRole('button', { name: /Send grades now/ })).toBeInTheDocument();
  });
});

/**
 * The panel beside one student's work.
 *
 * Its button sits next to that student's grade, so it must send that grade and nothing else.
 * Sending the class from here would deliver marks somebody had not finished checking.
 */
describe('the panel beside one student', () => {
  const showFor = (state: Partial<typeof linked>) => {
    const fetchMock = vi.fn().mockReturnValue(ok({ ...linked, ...state }));
    vi.stubGlobal('fetch', fetchMock);
    render(<GradeSyncCard assignmentId="a-1" variant="inline" studentId="u-7" />);
    return fetchMock;
  };

  it('asks about that student, not the assignment alone', async () => {
    const fetchMock = showFor({ student: { state: 'SENT', sentAt: null, lastError: null } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/assignments/a-1/lti-sync?userId=u-7'),
    );
  });

  it('sends only that student, and says so on the button', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok(linked));
    fetchMock
      .mockReturnValueOnce(
        ok({ ...linked, student: { state: 'PENDING', sentAt: null, lastError: null } }),
      )
      .mockReturnValueOnce(ok({ queued: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<GradeSyncCard assignmentId="a-1" variant="inline" studentId="u-7" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Send this grade now/ }));

    // The id in the body is the whole guard: without it the route sends the assignment.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/assignments/a-1/lti-sync',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'u-7' }) }),
      ),
    );
    expect(toastMock.success).toHaveBeenCalledWith('This grade is on its way to the LMS.');
  });

  it("quotes why this student's grade failed, which is the part somebody can act on", async () => {
    showFor({
      failed: 1,
      student: {
        state: 'FAILED',
        sentAt: null,
        lastError: 'Your LMS does not list this student in this course.',
      },
    });

    // The server's own sentence, verbatim. It is stored on the queue row, so the component
    // must not paraphrase it: an old failure would then be shown in words nobody wrote.
    expect(await screen.findByText(/does not list this student/)).toBeInTheDocument();
  });

  it("does not report the rest of the class as this student's state", async () => {
    showFor({ failed: 2, student: { state: 'SENT', sentAt: null, lastError: null } });

    expect(await screen.findByText('This grade has been sent to the LMS.')).toBeInTheDocument();
    expect(screen.queryByText(/2 grades could not be sent/)).not.toBeInTheDocument();
  });

  it('still offers to send the rest, so a failure elsewhere is not hidden', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok(linked));
    fetchMock
      .mockReturnValueOnce(
        ok({ ...linked, failed: 3, student: { state: 'SENT', sentAt: null, lastError: null } }),
      )
      .mockReturnValueOnce(ok({ queued: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<GradeSyncCard assignmentId="a-1" variant="inline" studentId="u-7" />);
    const user = userEvent.setup();

    expect(await screen.findByText(/3 other grades/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Send all outstanding grades/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/assignments/a-1/lti-sync',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
      ),
    );
  });

  it('offers nothing extra when this student is the only one outstanding', async () => {
    showFor({ failed: 1, student: { state: 'FAILED', sentAt: null, lastError: null } });

    await screen.findByRole('button', { name: /Send this grade now/ });
    expect(
      screen.queryByRole('button', { name: /Send all outstanding grades/ }),
    ).not.toBeInTheDocument();
  });

  it('falls back to the assignment when no student is open', async () => {
    const fetchMock = vi.fn().mockReturnValue(ok({ ...linked, failed: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<GradeSyncCard assignmentId="a-1" variant="inline" />);

    expect(await screen.findByText(/2 grades could not be sent to the LMS/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send grades now/ })).toBeInTheDocument();
  });
});
