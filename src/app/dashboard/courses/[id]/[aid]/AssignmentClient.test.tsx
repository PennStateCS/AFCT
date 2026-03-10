/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AssignmentWithDetails } from '@/lib/assignment-details';

const useSessionMock = vi.fn();
const studentViewMock = vi.fn();
const privilegeViewMock = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

vi.mock('@/components/assignments/StudentAssignmentView', () => ({
  __esModule: true,
  default: (props: { initialAssignment?: AssignmentWithDetails | null }) => {
    studentViewMock(props);
    return <div>student-view</div>;
  },
}));

vi.mock('@/components/assignments/PrivilegeAssignmentView', () => ({
  __esModule: true,
  default: (props: { initialAssignment?: AssignmentWithDetails | null }) => {
    privilegeViewMock(props);
    return <div>privilege-view</div>;
  },
}));

import AssignmentClient from './AssignmentClient';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AssignmentClient', () => {
  it('renders loading spinner while session is loading', () => {
    useSessionMock.mockReturnValue({ status: 'loading', data: null });

    render(<AssignmentClient />);

    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('routes students to student view with initial assignment', () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: { user: { role: 'STUDENT' } },
    });

    const initialAssignment = {
      id: 'a1',
      title: 'A1',
      courseId: 'c1',
      dueDate: new Date().toISOString(),
      maxPoints: 100,
      isPublished: true,
      problems: [],
    } as AssignmentWithDetails;

    render(<AssignmentClient initialAssignment={initialAssignment} />);

    expect(screen.getByText('student-view')).toBeInTheDocument();
    expect(studentViewMock).toHaveBeenCalledWith({ initialAssignment });
  });

  it('routes privileged users to privileged view', () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: { user: { role: 'FACULTY' } },
    });

    render(<AssignmentClient />);

    expect(screen.getByText('privilege-view')).toBeInTheDocument();
    expect(privilegeViewMock).toHaveBeenCalledWith({ initialAssignment: null });
  });
});
