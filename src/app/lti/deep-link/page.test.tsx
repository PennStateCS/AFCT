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
  prismaMock.assignment.findMany.mockResolvedValue([assignment('a1', 'Regular languages', 200)]);
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
    prismaMock.assignment.findMany.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => assignment(`a${i}`, `Assignment ${i}`, 100)),
    );

    await renderConnect();

    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getAllByRole('option')).toHaveLength(40);
    // A radio per assignment is what did not fit.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('says what an assignment is worth, and says so for ungraded ones too', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      assignment('a1', 'Graded work', 200),
      assignment('a2', 'Practice', null),
    ]);

    await renderConnect();

    expect(screen.getByRole('option', { name: /Graded work — 200 points/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Practice — not graded/ })).toBeInTheDocument();
  });

  it('picks the first assignment so the form can be submitted without a choice', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      assignment('a1', 'First', 100),
      assignment('a2', 'Second', 100),
    ]);

    await renderConnect();

    expect((screen.getByLabelText('Assignment') as HTMLSelectElement).value).toBe('a1');
  });

  it('carries the pending request through, so the post knows which launch it answers', async () => {
    const { container } = await renderConnect();

    expect(container.querySelector('input[name="pendingId"]')).toHaveValue('p1');
  });

  it('says so plainly when the course has nothing to link', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([]);

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
    prismaMock.assignment.findMany.mockResolvedValue([]);

    await renderPage();

    expect(screen.getByRole('link', { name: /Create a new assignment/ })).toBeInTheDocument();
    // Nothing to connect, so that door is shown closed rather than leading to an empty list.
    expect(
      screen.queryByRole('link', { name: /Use an assignment that already exists/ }),
    ).not.toBeInTheDocument();
  });

  it('says why the list is empty when everything has already been added', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([]);
    prismaMock.ltiDeepLink.count.mockResolvedValue(3);

    await renderConnect();

    expect(screen.getByText(/already been added/i)).toBeInTheDocument();
  });
});

/**
 * One link per assignment. Two links to the same work means two gradebook columns for it, and
 * the grades then disagree; the constraint is in the database, and this is the query that keeps
 * faculty from walking into it.
 */
it('leaves out assignments already opened by a link in this LMS course', async () => {
  await renderConnect();

  expect(prismaMock.assignment.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { courseId: 'c1', ltiDeepLinks: { none: { contextLinkId: 'cl1' } } },
    }),
  );
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
