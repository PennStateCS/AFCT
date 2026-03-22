/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  NavbarBreadcrumbProvider,
  useNavbarBreadcrumbs,
} from '@/components/navbar/NavbarBreadcrumbContext';
import CourseBreadcrumbSource from '@/components/navbar/CourseBreadcrumbSource';
import AssignmentBreadcrumbSource from '@/components/navbar/AssignmentBreadcrumbSource';

function BreadcrumbConsumer() {
  const { courseLabel, assignmentLabel } = useNavbarBreadcrumbs();
  return (
    <div>
      <span data-testid="course-label">
        {courseLabel ? `${courseLabel.id}:${courseLabel.name}` : 'none'}
      </span>
      <span data-testid="assignment-label">
        {assignmentLabel ? `${assignmentLabel.id}:${assignmentLabel.title}` : 'none'}
      </span>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('NavbarBreadcrumbContext + sources', () => {
  it('defaults labels to null', () => {
    render(
      <NavbarBreadcrumbProvider>
        <BreadcrumbConsumer />
      </NavbarBreadcrumbProvider>,
    );

    expect(screen.getByTestId('course-label')).toHaveTextContent('none');
    expect(screen.getByTestId('assignment-label')).toHaveTextContent('none');
  });

  it('sets course and assignment labels on mount', () => {
    render(
      <NavbarBreadcrumbProvider>
        <CourseBreadcrumbSource courseId="c1" courseName="Course One" />
        <AssignmentBreadcrumbSource assignmentId="a1" assignmentTitle="Assignment One" />
        <BreadcrumbConsumer />
      </NavbarBreadcrumbProvider>,
    );

    expect(screen.getByTestId('course-label')).toHaveTextContent('c1:Course One');
    expect(screen.getByTestId('assignment-label')).toHaveTextContent('a1:Assignment One');
  });

  it('clears labels on unmount', () => {
    const { rerender } = render(
      <NavbarBreadcrumbProvider>
        <CourseBreadcrumbSource courseId="c1" courseName="Course One" />
        <AssignmentBreadcrumbSource assignmentId="a1" assignmentTitle="Assignment One" />
        <BreadcrumbConsumer />
      </NavbarBreadcrumbProvider>,
    );

    expect(screen.getByTestId('course-label')).toHaveTextContent('c1:Course One');
    expect(screen.getByTestId('assignment-label')).toHaveTextContent('a1:Assignment One');

    rerender(
      <NavbarBreadcrumbProvider>
        <BreadcrumbConsumer />
      </NavbarBreadcrumbProvider>,
    );

    expect(screen.getByTestId('course-label')).toHaveTextContent('none');
    expect(screen.getByTestId('assignment-label')).toHaveTextContent('none');
  });
});
