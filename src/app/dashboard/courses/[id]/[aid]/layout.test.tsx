import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: {
    findFirst: vi.fn(),
  },
}));
const authMock = vi.hoisted(() => vi.fn());
const getCourseRoleMock = vi.hoisted(() => vi.fn());
const contentGateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/permissions', () => ({ getCourseRole: getCourseRoleMock }));
vi.mock('@/lib/assignment-student-gate', () => ({
  resolveStudentContentGate: contentGateMock,
}));
vi.mock('@/components/navbar/AssignmentBreadcrumbSource', () => ({
  __esModule: true,
  default: ({
    assignmentId,
    assignmentTitle,
  }: {
    assignmentId: string;
    assignmentTitle: string;
  }) => (
    <div
      data-testid="assignment-breadcrumb-source"
      data-assignment-id={assignmentId}
      data-assignment-title={assignmentTitle}
    />
  ),
}));

import AssignmentLayout from './layout';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
  getCourseRoleMock.mockResolvedValue('STUDENT');
  // Assigned by default; the audience-specific cases override it.
  contentGateMock.mockResolvedValue({ assigned: true, locked: false, unlockAt: null });
});

describe('AssignmentLayout', () => {
  it('renders breadcrumb source when a member views a published assignment', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Assignment One',
      isPublished: true,
    });

    const result = await AssignmentLayout({
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      children: <div data-testid="children">Child</div>,
    });

    expect(prismaMock.assignment.findFirst).toHaveBeenCalledWith({
      where: { id: 'a1', courseId: 'c1' },
      select: { id: true, title: true, isPublished: true },
    });

    const element = result as React.ReactElement<any>;
    expect(element.props.children).toHaveLength(2);
    const sourceNode = element.props.children[0];
    const childNode = element.props.children[1];

    expect(sourceNode.type).toBeDefined();
    expect(sourceNode.props.assignmentId).toBe('a1');
    expect(sourceNode.props.assignmentTitle).toBe('Assignment One');
    expect(childNode.props['data-testid']).toBe('children');
  });

  it('renders only children when assignment is not found', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const result = await AssignmentLayout({
      params: Promise.resolve({ id: 'c1', aid: 'missing' }),
      children: <div data-testid="children">Child</div>,
    });

    const element = result as React.ReactElement<any>;
    expect(element.props.children[0]).toBeNull();
    expect(element.props.children[1].props['data-testid']).toBe('children');
  });

  it('does not query or expose the assignment for a non-member', async () => {
    getCourseRoleMock.mockResolvedValue(null); // not enrolled, not admin

    const result = await AssignmentLayout({
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      children: <div data-testid="children">Child</div>,
    });

    expect(getCourseRoleMock).toHaveBeenCalledWith('u1', 'c1');
    expect(prismaMock.assignment.findFirst).not.toHaveBeenCalled();
    const element = result as React.ReactElement<any>;
    expect(element.props.children[0]).toBeNull();
  });

  it('hides an unpublished assignment title from a student', async () => {
    getCourseRoleMock.mockResolvedValue('STUDENT');
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Secret Draft',
      isPublished: false,
    });

    const result = await AssignmentLayout({
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      children: <div data-testid="children">Child</div>,
    });

    const element = result as React.ReactElement<any>;
    expect(element.props.children[0]).toBeNull();
  });

  it('shows an unpublished assignment title to staff', async () => {
    getCourseRoleMock.mockResolvedValue('FACULTY');
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Draft',
      isPublished: false,
    });

    const result = await AssignmentLayout({
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      children: <div data-testid="children">Child</div>,
    });

    const element = result as React.ReactElement<any>;
    expect(element.props.children[0].props.assignmentTitle).toBe('Draft');
  });

  it('hides the breadcrumb from a student the assignment is not assigned to', async () => {
    // Published is not enough. Work scoped to specific classmates must not have its
    // title readable by the rest of the course, and the breadcrumb is a third surface
    // (alongside the page and the API) that renders it.
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Make-up Exam',
      isPublished: true,
    });
    contentGateMock.mockResolvedValue({ assigned: false, locked: true, unlockAt: null });

    const result = await AssignmentLayout({
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      children: <div data-testid="children">Child</div>,
    });
    const element = result as React.ReactElement<any>;
    expect(element.props.children[0]).toBeNull();
  });

  it('still shows the breadcrumb before unlock, since the title is not the secret', async () => {
    // A student who IS assigned already sees the assignment listed with its opening
    // date; the unlock gate hides the body, not the existence.
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Locked Lab',
      isPublished: true,
    });
    contentGateMock.mockResolvedValue({ assigned: true, locked: true, unlockAt: new Date() });

    const result = await AssignmentLayout({
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      children: <div data-testid="children">Child</div>,
    });
    const element = result as React.ReactElement<any>;
    expect(element.props.children[0]?.props.assignmentTitle).toBe('Locked Lab');
  });

  it('does not consult the audience gate for staff', async () => {
    getCourseRoleMock.mockResolvedValue('FACULTY');
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Unpublished Draft',
      isPublished: false,
    });

    const result = await AssignmentLayout({
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      children: <div data-testid="children">Child</div>,
    });
    const element = result as React.ReactElement<any>;
    expect(element.props.children[0]?.props.assignmentTitle).toBe('Unpublished Draft');
    expect(contentGateMock).not.toHaveBeenCalled();
  });
});
