/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { StudentSchedule } from './StudentSchedule';

const assignment = {
  dueDate: '2026-01-10T00:00:00.000Z',
  allowLateSubmissions: false,
  lateCutoff: null,
};

const renderSchedule = (props: Partial<React.ComponentProps<typeof StudentSchedule>> = {}) =>
  render(<StudentSchedule assignment={assignment} timezone="UTC" {...props} />);

describe('StudentSchedule', () => {
  it('labels the due date and the late window separately', () => {
    renderSchedule();

    expect(screen.getByText('Due')).toBeInTheDocument();
    // The label carries the state: no late work at all is "Late work / Not accepted".
    expect(screen.getByText('Late work')).toBeInTheDocument();
    expect(screen.getByText('Not accepted')).toBeInTheDocument();
  });

  it('shows the cutoff as the label when late work is taken', () => {
    renderSchedule({
      assignment: {
        ...assignment,
        allowLateSubmissions: true,
        lateCutoff: '2026-01-12T23:30:00.000Z',
      },
    });

    expect(screen.getByText('Late until')).toBeInTheDocument();
    expect(screen.getByText(/Jan 12/)).toBeInTheDocument();
  });

  it('says there is no cutoff rather than showing an empty value', () => {
    renderSchedule({
      assignment: { ...assignment, allowLateSubmissions: true, lateCutoff: null },
    });

    expect(screen.getByText('No cutoff')).toBeInTheDocument();
  });

  // A compact date, not "01/10/26 12:00 AM": the strip is short of width, and the year is
  // already established by the course on screen.
  it('shows the due date in the short form, read in the given zone', () => {
    renderSchedule();

    expect(screen.getByText(/Jan 10/)).toBeInTheDocument();
  });

  it('says so while the assignment is still loading', () => {
    renderSchedule({ loading: true });

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders nothing when there is no assignment', () => {
    const { container } = render(<StudentSchedule assignment={null} timezone="UTC" />);

    expect(container).toBeEmptyDOMElement();
  });

  /**
   * These dates are the STUDENT's, not the assignment's. `effectiveDeadline` merges an
   * override over the base field by field, so marking the whole line, or always marking the
   * due date, would point at values that did not change.
   */
  describe('overrides', () => {
    const withOverride = (over: Record<string, unknown>) =>
      renderSchedule({
        effective: {
          unlockAt: null,
          dueDate: '2026-01-10T00:00:00.000Z',
          lateCutoff: null,
          allowLateSubmissions: false,
          source: 'student-override',
          ...over,
        } as never,
      });

    it('marks a moved due date', () => {
      withOverride({ dueDate: '2026-02-01T00:00:00.000Z' });

      expect(screen.getByText('(student override)')).toBeInTheDocument();
    });

    it('says when the override came from the group rather than the student', () => {
      withOverride({ dueDate: '2026-02-01T00:00:00.000Z', source: 'group-override' });

      expect(screen.getByText('(group override)')).toBeInTheDocument();
    });

    // The case that motivated per-field marking: only the late window moved.
    it('marks only the fields that actually changed', () => {
      withOverride({ allowLateSubmissions: true, lateCutoff: '2026-01-20T00:00:00.000Z' });

      // The late window changed; the due date did not. One mark, on the late reading.
      expect(screen.getAllByText('(student override)')).toHaveLength(1);
      expect(screen.getByText('Due').parentElement?.textContent).not.toContain('override');
    });

    it('marks nothing when the student is on the base schedule', () => {
      withOverride({ source: 'base' });

      expect(screen.queryByText(/override/)).not.toBeInTheDocument();
    });
  });
});
