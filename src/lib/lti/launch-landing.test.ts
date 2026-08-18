import { describe, it, expect } from 'vitest';
import {
  dashboardWithNotice,
  asLaunchNotice,
  launchNoticeMessage,
} from '@/lib/lti/launch-landing';

describe('dashboardWithNotice', () => {
  it('carries the reason and the LMS course name', () => {
    const url = new URL(dashboardWithNotice('not-linked', 'CMPSC 464 Fall 2026'), 'https://a.test');

    expect(url.pathname).toBe('/dashboard');
    expect(url.searchParams.get('lms')).toBe('not-linked');
    expect(url.searchParams.get('course')).toBe('CMPSC 464 Fall 2026');
  });

  it('leaves the name out when the launch did not give one', () => {
    const url = new URL(dashboardWithNotice('not-published', null), 'https://a.test');

    expect(url.searchParams.has('course')).toBe(false);
  });

  /** The title is the LMS's text, so its length is not ours to trust. */
  it('bounds a course name from the LMS', () => {
    const url = new URL(dashboardWithNotice('not-linked', 'x'.repeat(500)), 'https://a.test');

    expect(url.searchParams.get('course')!.length).toBe(80);
  });

  it('escapes a name rather than letting it add parameters', () => {
    const url = new URL(
      dashboardWithNotice('not-linked', 'Theory&lms=no-courses'),
      'https://a.test',
    );

    expect(url.searchParams.get('lms')).toBe('not-linked');
    expect(url.searchParams.get('course')).toBe('Theory&lms=no-courses');
  });
});

describe('asLaunchNotice', () => {
  it('accepts the reasons this build knows', () => {
    expect(asLaunchNotice('not-published')).toBe('not-published');
  });

  it('rejects anything else, so a made-up parameter says nothing', () => {
    expect(asLaunchNotice('anything')).toBeNull();
    expect(asLaunchNotice(null)).toBeNull();
    expect(asLaunchNotice(undefined)).toBeNull();
  });
});

describe('launchNoticeMessage', () => {
  it('names the course when it can, and stays readable when it cannot', () => {
    expect(launchNoticeMessage('not-published', 'Theory')).toContain('"Theory"');
    expect(launchNoticeMessage('not-published', null)).toContain('that course');
  });

  it('tells a student the course will appear once it is published', () => {
    expect(launchNoticeMessage('not-published', 'Theory')).toMatch(/appear here/);
  });

  it('tells staff with no course who creates one', () => {
    expect(launchNoticeMessage('no-courses', null)).toMatch(/administrator/);
  });
});
