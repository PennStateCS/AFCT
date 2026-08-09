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
  it('labels the due date and the late policy separately', () => {
    renderSchedule();

    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getByText('Late Policy')).toBeInTheDocument();
  });

  it('says so while the assignment is still loading', () => {
    renderSchedule({ loading: true });

    expect(screen.getByText('Loading assignment...')).toBeInTheDocument();
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

      // Allow Late and Late Cutoff both changed; the due date did not.
      expect(screen.getAllByText('(student override)')).toHaveLength(2);
      expect(screen.getByText('Due').parentElement?.textContent).not.toContain('override');
    });

    it('marks nothing when the student is on the base schedule', () => {
      withOverride({ source: 'base' });

      expect(screen.queryByText(/override/)).not.toBeInTheDocument();
    });
  });
});
