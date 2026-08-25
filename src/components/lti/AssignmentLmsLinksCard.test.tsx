/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  confirmedAt: '2026-08-18T14:05:00.000Z',
  addedBy: 'Ada Lovelace',
};

/** A link AFCT returned and has heard nothing about since. */
const neverOpened: AssignmentLmsLink = { ...link, id: 'link-2', confirmedAt: null };

function show(
  links: AssignmentLmsLink[],
  onRemoved = vi.fn(),
  archived = false,
  extra?: { failed?: boolean; onRetry?: () => void },
) {
  render(
    <AssignmentLmsLinksCard
      courseId="c-1"
      assignmentId="a-1"
      links={links}
      loading={false}
      failed={extra?.failed}
      courseIsArchived={archived}
      onRemoved={onRemoved}
      onRetry={extra?.onRetry}
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

    expect(screen.getByText(/not linked from an LMS course yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  /*
   * The empty state has to name the workflow, because it happens somewhere else. A link is
   * made in the LMS, which then asks AFCT which assignment to open; nothing on this page
   * creates one. "Add it from the LMS itself, where an AFCT link asks which assignment it
   * should open" said that, but only to somebody who already knew it.
   */
  it('says the link is made in the LMS course, not here', () => {
    show([]);

    expect(screen.getByText(/add an AFCT link in your LMS course/)).toBeInTheDocument();
    expect(screen.getByText(/choose this assignment/)).toBeInTheDocument();
  });

  // Nothing here knows whether the COURSE is connected: this card reads assignment links only.
  it('does not claim anything about the course connection', () => {
    show([]);

    expect(screen.queryByText(/course is( not)? connected/i)).not.toBeInTheDocument();
  });
});

/*
 * The card names what it lists. "In your LMS" was two problems at once: it did not say the
 * card is about links, and "in" overclaims for a link the platform has not confirmed.
 */
describe('what the card is called', () => {
  it('is titled LMS assignment links', () => {
    show([link]);

    expect(screen.getByRole('heading', { name: 'LMS assignment links' })).toBeInTheDocument();
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

  /*
   * The one misreading this card exists to prevent: Remove is AFCT's bookkeeping, and the link
   * in the LMS goes on working. Somebody who believes otherwise leaves a live link nobody is
   * watching. Said in the card and again in the confirmation, so it cannot be missed by
   * clicking through.
   */
  it('says removal does not delete the link from the LMS course', async () => {
    show([link]);

    expect(screen.getByText(/does not delete the link from the LMS course/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/will not be deleted/)).toBeInTheDocument();
  });

  /*
   * The dialog leads with the consequence to the reader, and names the course being forgotten.
   * It used to open with "AFCT stops treating this assignment as already added to", which
   * describes the implementation rather than the outcome.
   */
  it('names the LMS course in the confirmation, and says the link can be made again', async () => {
    show([link]);

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('alertdialog').catch(() => screen.getByRole('dialog'));
    expect(dialog).toHaveTextContent(/AFCT will forget/);
    expect(dialog).toHaveTextContent('CMPSC 464 Fall 2026 in Canvas');
    expect(dialog).toHaveTextContent(/link the assignment again/);
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

/**
 * A read that failed is not a read that found nothing.
 *
 * Saying "not added to your LMS" because a request 500'd invites somebody to add a second link
 * for work that already has one, which is two gradebook columns and two disagreeing grades.
 */
describe('when the links cannot be read', () => {
  it('says so, and does not claim the assignment is absent from the LMS', () => {
    show([], vi.fn(), false, { failed: true });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /could not check this assignment's LMS links/i,
    );
    expect(screen.queryByText(/not linked from an LMS course yet/)).not.toBeInTheDocument();
  });

  it('offers a retry', async () => {
    const onRetry = vi.fn();
    show([], vi.fn(), false, { failed: true, onRetry });

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalled();
  });

  it('still says plainly when the answer really is none', () => {
    show([]);

    expect(screen.getByText(/not linked from an LMS course yet/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // The reason the failure state exists at all, said in the copy rather than only in a comment.
  it('warns against adding a second link before retrying', () => {
    show([], vi.fn(), false, { failed: true });

    expect(screen.getByRole('alert')).toHaveTextContent(/try again before adding another one/i);
  });
});

/**
 * The half of #697 this card cannot solve on its own. A link nobody has opened is usually a
 * real one nobody has clicked, so the card has to say what it does not know without turning
 * "remove it and add it again" into the obvious next step.
 */
describe('a link nobody has opened yet', () => {
  /*
   * Names the platform in the instruction. "Open it there once to settle it" left the reader
   * to work out where "there" was; "Open it once from Canvas" is something they can do.
   */
  it('says AFCT cannot confirm the link, and where to open it', () => {
    show([neverOpened]);

    expect(screen.getByText(/Not opened from Canvas yet/)).toBeInTheDocument();
    expect(screen.getByText(/Open it once from Canvas to confirm it/)).toBeInTheDocument();
  });

  // It says what AFCT does not know, not that the link is broken. Most unopened links are fine.
  it('does not call the link broken', () => {
    show([neverOpened]);

    expect(screen.queryByText(/broken|failed|refused/i)).not.toBeInTheDocument();
  });

  it('says nothing of the kind about a link that has been opened', () => {
    show([link]);

    expect(screen.queryByText(/cannot confirm the link was set up/)).not.toBeInTheDocument();
  });

  /** Removing is still offered: a refused link is exactly what it is there for. */
  it('can still be removed', () => {
    show([neverOpened]);

    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });
});

/**
 * The announced half of each state.
 *
 * One region, deliberately not a copy of the visible paragraph: a screen reader would then hear
 * the same sentence twice, once announced and once in the page. Short enough to be the answer.
 */
describe('what is announced', () => {
  it('says it is checking while the links load', () => {
    render(
      <AssignmentLmsLinksCard
        courseId="c-1"
        assignmentId="a-1"
        links={[]}
        loading
        onRemoved={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Checking LMS assignment links.');
  });

  it('says none were found', () => {
    show([]);

    expect(screen.getByRole('status')).toHaveTextContent('No LMS assignment links found.');
  });

  it('counts the courses an assignment is linked from', () => {
    show([link, { ...link, id: 'link-3', context: 'CMPSC 464 Spring 2027' }]);

    expect(screen.getByRole('status')).toHaveTextContent('Linked from 2 LMS courses.');
  });

  it('counts one in the singular', () => {
    show([link]);

    expect(screen.getByRole('status')).toHaveTextContent('Linked from 1 LMS course.');
  });

  // A failed read announces nothing: the visible alert is announced by its own role.
  it('announces nothing when the read failed, so the alert is not doubled', () => {
    show([], vi.fn(), false, { failed: true });

    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});

/**
 * Focus after a removal.
 *
 * The Remove button lives inside the row the removal deletes, and Radix restores focus to
 * whatever opened the dialog. Restoring to a node that has gone drops focus to the body, so a
 * keyboard user was thrown back to the top of the page after every removal.
 */
describe('where focus goes after removing a link', () => {
  it('lands on the card heading rather than on the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
    );
    const onRemoved = show([link]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('link-1'));
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toHaveTextContent('LMS assignment links');
    });
  });
});
