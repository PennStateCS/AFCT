/** @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const canManageCourseMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  ltiPendingDeepLink: { findFirst: vi.fn() },
  ltiContextLink: { findUnique: vi.fn() },
  assignment: { findMany: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/permissions', () => ({ canManageCourse: canManageCourseMock }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirected to ${to}`);
  },
}));

import DeepLinkPage from './page';

/** The page is an async server component, so it is called and its output rendered. */
const renderPage = async () => render(await DeepLinkPage({ searchParams: Promise.resolve({ pending: 'p1' }) }));

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
    courseId: 'c1',
    course: { name: 'Theory of Computation' },
  });
  prismaMock.assignment.findMany.mockResolvedValue([assignment('a1', 'Regular languages', 200)]);
});

describe('the deep-link assignment picker', () => {
  it('offers the assignments as one labelled control', async () => {
    await renderPage();

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

    await renderPage();

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

    await renderPage();

    expect(screen.getByRole('option', { name: /Graded work — 200 points/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Practice — not graded/ })).toBeInTheDocument();
  });

  it('picks the first assignment so the form can be submitted without a choice', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      assignment('a1', 'First', 100),
      assignment('a2', 'Second', 100),
    ]);

    await renderPage();

    expect((screen.getByLabelText('Assignment') as HTMLSelectElement).value).toBe('a1');
  });

  it('carries the pending request through, so the post knows which launch it answers', async () => {
    const { container } = await renderPage();

    expect(container.querySelector('input[name="pendingId"]')).toHaveValue('p1');
  });

  it('says so plainly when the course has nothing to link', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([]);

    await renderPage();

    expect(screen.getByText(/no assignments to link/i)).toBeInTheDocument();
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
