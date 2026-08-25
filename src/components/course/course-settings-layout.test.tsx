/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Course } from '@prisma/client';

import { CourseSettingsForm } from './CourseSettingsForm';
import { CourseStatusCard } from './CourseStatusCard';

vi.mock('@/lib/toast', () => ({ showToast: { error: vi.fn(), success: vi.fn() } }));

const COURSE = {
  id: 'course-1',
  name: 'Introduction to Digital Systems',
  code: 'CMPEN 271',
  semester: 'Summer 2026',
  credits: 4,
  startDate: new Date('2026-07-23T03:36:00.000Z'),
  endDate: new Date('2026-10-24T03:36:00.000Z'),
  registrationOpenAt: null,
  registrationCloseAt: null,
  isPublished: true,
  isArchived: false,
  emptyStringNotation: 'EPSILON',
  timezone: 'America/New_York',
} as unknown as Course;

/**
 * The Settings tab's shape, not its behaviour.
 *
 * It used to be one `max-w-xl` column of eleven fields with the publish switch floating in a
 * card several hundred pixels off its right edge, on a tab professors reach straight from
 * System Settings. It now uses the shared settings vocabulary, and what is worth pinning is
 * the grammar that vocabulary provides: named panels a screen reader can jump between, and a
 * heading level that sits under the tab's own "Course Settings" rather than beside it.
 *
 * jsdom does no layout, so none of this proves the page looks right. It proves the sections
 * exist and are labelled, which is the part a later edit can silently undo.
 */
describe('the course Settings tab', () => {
  it('groups the fields into named sections rather than one long column', () => {
    render(<CourseSettingsForm course={COURSE} />);

    for (const title of ['Course details', 'Dates and timezone', 'Self registration', 'Notation']) {
      const section = screen.getByRole('region', { name: title });
      expect(within(section).getByRole('heading', { name: title })).toBeVisible();
    }

    // Each field landed in the group it belongs to, not merely somewhere on the page.
    const dates = screen.getByRole('region', { name: 'Dates and timezone' });
    expect(within(dates).getByLabelText(/Course timezone/)).toBeInTheDocument();
    expect(within(dates).getByLabelText(/Start Date/)).toBeInTheDocument();
    expect(within(dates).getByLabelText(/End Date/)).toBeInTheDocument();
  });

  /*
   * h3, because the tab already renders a "Course Settings" h2 above these. As h2s they
   * claimed to be that heading's siblings, which puts a screen reader's heading list back to
   * the flat one this change exists to fix.
   */
  it('keeps its sections under the tab heading, not beside it', () => {
    render(<CourseSettingsForm course={COURSE} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Course details' })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('saves the whole form from one footer', () => {
    render(<CourseSettingsForm course={COURSE} />);

    expect(screen.getAllByRole('button', { name: /Save Changes/ })).toHaveLength(1);
  });

  /*
   * The publish switch applies on confirmation, not on Save. Inside the form, above a Save
   * button, it reads as something Save commits. In the rail it is what System Settings does
   * with the same kind of control, and it is a landmark of its own either way.
   */
  it('puts the immediate-effect switch in its own labelled card, outside the form', () => {
    render(
      <>
        <CourseSettingsForm course={COURSE} />
        <CourseStatusCard course={COURSE} onPublishToggle={vi.fn()} />
      </>,
    );

    const card = screen.getByRole('complementary', { name: 'Course Status' });
    const toggle = screen.getByRole('switch', { name: /Published/ });
    expect(card).toContainElement(toggle);
    expect(document.querySelector('form')).not.toContainElement(toggle);
  });
});
