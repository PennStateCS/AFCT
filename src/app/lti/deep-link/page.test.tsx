/** @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const canManageCourseMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  ltiPendingDeepLink: { findFirst: vi.fn() },
  ltiContextLink: { findUnique: vi.fn() },
  assignment: { findMany: vi.fn() },
  ltiDeepLink: { count: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/permissions', () => ({ canManageCourse: canManageCourseMock }));
vi.mock('@/lib/course-timezone', () => ({ resolveCourseTimezone: async () => 'America/New_York' }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));

import DeepLinkPage from './page';

/** The page is an async server component, so it is called and its output rendered. */
const renderPage = async (params: Record<string, string> = {}) =>
  render(await DeepLinkPage({ searchParams: Promise.resolve({ pending: 'p1', ...params }) }));

/** The step that lists what already exists, which is where the old single-screen picker went. */
const renderConnect = () => renderPage({ mode: 'connect' });

const assignment = (id: string, title: string, points: number | null) => ({
  id,
  title,
  problems: points === null ? [] : [{ maxPoints: points }],
});

type Assignment = ReturnType<typeof assignment>;

/**
 * The page runs two `findMany` calls that differ only in their `where`, so the mock has to tell
 * them apart or every assignment comes back in both groups. `none` is the list nothing has been
 * added from; `some` with `confirmedAt: null` is the list AFCT sent but never saw opened.
 */
const setAssignments = (notAdded: Assignment[], neverOpened: Assignment[] = []) => {
  prismaMock.assignment.findMany.mockImplementation(async (args: { where?: unknown }) => {
    const where = args.where as { ltiDeepLinks?: { none?: unknown; some?: unknown } } | undefined;
    return where?.ltiDeepLinks?.some ? neverOpened : notAdded;
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  canManageCourseMock.mockResolvedValue(true);
  prismaMock.ltiPendingDeepLink.findFirst.mockResolvedValue({
    id: 'p1',
    contextId: 'ctx1',
    platformId: 'plat1',
  });
  prismaMock.ltiContextLink.findUnique.mockResolvedValue({
    id: 'cl1',
    courseId: 'c1',
    course: { name: 'Theory of Computation' },
  });
  prismaMock.ltiDeepLink.count.mockResolvedValue(0);
  setAssignments([assignment('a1', 'Regular languages', 200)]);
});

describe('the deep-link assignment picker', () => {
  it('offers the assignments as one labelled control', async () => {
    await renderConnect();

    const picker = screen.getByLabelText('Assignment');
    expect(picker.tagName).toBe('SELECT');
    expect(within(picker).getByRole('option', { name: /Regular languages/ })).toBeInTheDocument();
  });

  /**
   * The reason this is a select at all. An LMS draws this page in a modal a few hundred pixels
   * tall, and a term's worth of assignments as a list of radios does not fit in it.
   */
  it('stays one control when a course has a term of assignments', async () => {
    setAssignments(
      Array.from({ length: 40 }, (_, i) => assignment(`a${i}`, `Assignment ${i}`, 100)),
    );

    await renderConnect();

    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getAllByRole('option')).toHaveLength(40);
    // A radio per assignment is what did not fit.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('says what an assignment is worth, and says so for ungraded ones too', async () => {
    setAssignments([assignment('a1', 'Graded work', 200), assignment('a2', 'Practice', null)]);

    await renderConnect();

    // A comma, not a dash: an option's text is its accessible name, and a screen reader reads
    // the dash aloud between the title and the points.
    expect(screen.getByRole('option', { name: /Graded work, 200 points/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Practice, not graded/ })).toBeInTheDocument();
  });

  it('picks the first assignment so the form can be submitted without a choice', async () => {
    setAssignments([assignment('a1', 'First', 100), assignment('a2', 'Second', 100)]);

    await renderConnect();

    expect((screen.getByLabelText('Assignment') as HTMLSelectElement).value).toBe('a1');
  });

  it('carries the pending request through, so the post knows which launch it answers', async () => {
    const { container } = await renderConnect();

    expect(container.querySelector('input[name="pendingId"]')).toHaveValue('p1');
  });

  it('says so plainly when the course has nothing to link', async () => {
    setAssignments([]);

    await renderConnect();

    expect(screen.getByText(/no assignments yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('refuses to offer a course the person does not run', async () => {
    // Otherwise a deep link is a way to attach somebody else's assignment to your own LMS course.
    canManageCourseMock.mockResolvedValue(false);

    await renderPage();

    expect(screen.getByText(/Only the people who run/)).toBeInTheDocument();
    expect(prismaMock.assignment.findMany).not.toHaveBeenCalled();
  });
});

/**
 * The two ways in. Faculty adding an LMS link are usually building the assignment right then,
 * so "there is nothing to choose yet" used to be a dead end that sent them back to AFCT.
 */
describe('choosing what the link opens', () => {
  it('offers both an existing assignment and a new one', async () => {
    await renderPage();

    expect(
      screen.getByRole('link', { name: /Use an assignment that already exists/ }),
    ).toHaveAttribute('href', '/lti/deep-link?pending=p1&mode=connect');
    expect(screen.getByRole('link', { name: /Create a new assignment/ })).toHaveAttribute(
      'href',
      '/lti/deep-link?pending=p1&mode=create',
    );
  });

  it('still offers to create one when the course has no assignments at all', async () => {
    setAssignments([]);

    await renderPage();

    expect(screen.getByRole('link', { name: /Create a new assignment/ })).toBeInTheDocument();
    // Nothing to connect, so that door is shown closed rather than leading to an empty list.
    expect(
      screen.queryByRole('link', { name: /Use an assignment that already exists/ }),
    ).not.toBeInTheDocument();
  });

  it('says why the list is empty when everything has already been added', async () => {
    setAssignments([]);
    prismaMock.ltiDeepLink.count.mockResolvedValue(3);

    await renderConnect();

    expect(screen.getByText(/already been added/i)).toBeInTheDocument();
  });
});

/**
 * One link per assignment. Two links to the same work means two gradebook columns for it, and
 * the grades then disagree; the constraint is in the database, and this query is the first of
 * the two things keeping faculty from walking into it. The second is the heading below, which
 * is what a link AFCT cannot vouch for gets instead of being hidden.
 */
it('leaves out assignments already opened by a link in this LMS course', async () => {
  await renderConnect();

  expect(prismaMock.assignment.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { courseId: 'c1', ltiDeepLinks: { none: { contextLinkId: 'cl1' } } },
    }),
  );
});

/**
 * The other half of #697. A link AFCT recorded but the LMS never accepted used to hide its
 * assignment from this list for good, and the only way back was removing the record by hand.
 */
describe('assignments whose link was never opened', () => {
  it('offers them again, under a heading that says what they are', async () => {
    setAssignments([assignment('a1', 'Regular languages', 200)], [assignment('a2', 'Pumping', 50)]);

    await renderConnect();

    const picker = screen.getByLabelText('Assignment') as HTMLSelectElement;
    const group = within(picker).getByRole('group', { name: 'Added before, but never opened' });
    expect(within(group).getByRole('option', { name: /Pumping/ })).toBeInTheDocument();
    // And the one nobody has added is still offered, under its own heading.
    expect(
      within(within(picker).getByRole('group', { name: 'Not in this LMS course' })).getByRole(
        'option',
        { name: /Regular languages/ },
      ),
    ).toBeInTheDocument();
  });

  /**
   * The warning is the point. An unconfirmed link is usually a real one nobody has clicked, so
   * re-adding it is how a course ends up with two links and two columns for one assignment:
   * worse than the stranded record this lets somebody escape.
   */
  it('says what to do before adding one again', async () => {
    setAssignments([], [assignment('a2', 'Pumping', 50)]);

    await renderConnect();

    expect(screen.getByText(/Open it in your LMS to find out/)).toBeInTheDocument();
    expect(screen.getByText(/two links and two gradebook columns/)).toBeInTheDocument();
  });

  it('is still offered when it is the only thing left to add', async () => {
    setAssignments([], [assignment('a2', 'Pumping', 50)]);

    await renderConnect();

    expect(screen.getByLabelText('Assignment')).toHaveValue('a2');
    expect(screen.queryByText(/Nothing left to add/)).not.toBeInTheDocument();
  });

  /** No heading when there is nothing to contrast with: it would only restate the list. */
  it('leaves the list ungrouped when every assignment is simply unadded', async () => {
    setAssignments([assignment('a1', 'Regular languages', 200)]);

    await renderConnect();

    expect(
      within(screen.getByLabelText('Assignment')).queryByRole('group'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/never opened/)).not.toBeInTheDocument();
  });

  /** The count beside the list is what AFCT is sure of, so an unconfirmed link is not in it. */
  it('counts only confirmed links as already added', async () => {
    await renderConnect();

    expect(prismaMock.ltiDeepLink.count).toHaveBeenCalledWith({
      where: { contextLinkId: 'cl1', confirmedAt: { not: null } },
    });
  });
});

it('mentions how many are hidden, so a missing assignment is explained', async () => {
  prismaMock.ltiDeepLink.count.mockResolvedValue(2);

  await renderConnect();

  expect(screen.getByText(/2 already added to this course are not listed/)).toBeInTheDocument();
});

/**
 * The create step. Deliberately the smallest assignment AFCT will take: this is a modal inside
 * somebody else's software, and everything here is editable in AFCT afterwards.
 */
describe('creating one from here', () => {
  it('asks only for a title and the dates', async () => {
    const { container } = await renderPage({ mode: 'create' });

    expect(screen.getByLabelText('Title')).toBeRequired();
    expect(screen.getByLabelText('Due date')).toBeRequired();
    expect(screen.getByLabelText(/Available from/)).not.toBeRequired();
    expect(container.querySelector('input[name="mode"]')).toHaveValue('create');
  });

  it('publishes by default, since an unpublished assignment opens nothing for a student', async () => {
    await renderPage({ mode: 'create' });

    expect(screen.getByRole('checkbox', { name: /Publish it now/ })).toBeChecked();
  });

  it('explains itself when the last attempt was refused', async () => {
    await renderPage({ mode: 'create', error: 'missing-title' });

    expect(screen.getByRole('alert')).toHaveTextContent(/title and a due date/);
  });
});
