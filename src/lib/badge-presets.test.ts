import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_CATEGORY_BADGE,
  ACTIVITY_SEVERITY_BADGE,
  ACTIVITY_SEVERITY_FALLBACK,
  COURSE_LIFECYCLE_BADGE,
  ENROLLMENT_STATUS_BADGE,
  REGISTRATION_STATUS_BADGE,
  ROLE_BADGE,
} from './badge-presets';

/**
 * These are the mappings that used to be written out in each component that needed them, and
 * had already drifted once. The point of the tests is the rule each map follows, not the
 * individual values.
 */
const SEMANTIC = ['success', 'warning', 'danger', 'info', 'neutral'];
const isCategorical = (v: string) => v.startsWith('category-');

describe('course and registration status', () => {
  it('reads open as good, upcoming as informational and closed as neither', () => {
    expect(COURSE_LIFECYCLE_BADGE.open).toBe('success');
    expect(COURSE_LIFECYCLE_BADGE.upcoming).toBe('info');
    expect(COURSE_LIFECYCLE_BADGE.closed).toBe('neutral');
  });

  it('keeps registration a separate map even where it agrees today', () => {
    expect(REGISTRATION_STATUS_BADGE).toEqual(COURSE_LIFECYCLE_BADGE);
    // Separate objects, so changing one cannot silently change the other.
    expect(REGISTRATION_STATUS_BADGE).not.toBe(COURSE_LIFECYCLE_BADGE);
  });

  it('uses only semantic variants, because both describe a state', () => {
    for (const v of [
      ...Object.values(COURSE_LIFECYCLE_BADGE),
      ...Object.values(REGISTRATION_STATUS_BADGE),
    ]) {
      expect(SEMANTIC).toContain(v);
    }
  });
});

describe('roles and categories', () => {
  it('gives every role a categorical hue and never a semantic one', () => {
    for (const v of Object.values(ROLE_BADGE)) {
      expect(isCategorical(v)).toBe(true);
      expect(SEMANTIC).not.toContain(v);
    }
  });

  it('places Admin on violet and Student on slate, not on red and green', () => {
    expect(ROLE_BADGE.ADMIN).toBe('category-violet');
    expect(ROLE_BADGE.FACULTY).toBe('category-blue');
    expect(ROLE_BADGE.TA).toBe('category-amber');
    expect(ROLE_BADGE.STUDENT).toBe('category-slate');
  });

  it('gives every log category a categorical hue, Grade included', () => {
    for (const v of Object.values(ACTIVITY_CATEGORY_BADGE)) {
      expect(isCategorical(v)).toBe(true);
    }
    expect(ACTIVITY_CATEGORY_BADGE.GRADE).toBe('category-rose');
  });

  it('gives no two categories the same hue, which is the only job the colour has', () => {
    const hues = Object.values(ACTIVITY_CATEGORY_BADGE);
    expect(new Set(hues).size).toBe(hues.length);
  });
});

describe('enrolment standing', () => {
  /** Standing is a state, so it stays semantic; the role beside it stays categorical. */
  it('stays semantic and separate from the role map', () => {
    for (const v of Object.values(ENROLLMENT_STATUS_BADGE)) {
      expect(SEMANTIC).toContain(v);
    }
    expect(Object.values(ROLE_BADGE)).not.toContain(ENROLLMENT_STATUS_BADGE.ENROLLED);
  });
});

/**
 * Severity and category answer different questions on the same row: how urgent, and about
 * what. The tests are that separation, plus the one value that carries the page's calm.
 */
describe('activity-log severity', () => {
  it('keeps severity semantic, never categorical', () => {
    for (const v of Object.values(ACTIVITY_SEVERITY_BADGE)) {
      expect(SEMANTIC.concat('destructive')).toContain(v);
      expect(isCategorical(v)).toBe(false);
    }
  });

  /*
   * The one that matters. Nearly every entry a healthy system writes is INFO, so an INFO badge
   * with a colour of its own paints a stripe down the page and spends the reader's attention
   * on the rows that need it least. It was `info` (blue) and that is what this guards against.
   */
  it('leaves routine entries quiet', () => {
    expect(ACTIVITY_SEVERITY_BADGE.INFO).toBe('neutral');
    expect(ACTIVITY_SEVERITY_FALLBACK).toBe('neutral');
  });

  it('escalates from there, and keeps error and security apart', () => {
    expect(ACTIVITY_SEVERITY_BADGE.WARNING).toBe('warning');
    expect(ACTIVITY_SEVERITY_BADGE.ERROR).toBe('danger');
    // Not two names for red: `danger` is the soft fill every other badge here uses, and
    // `destructive` is a solid red with white on it.
    expect(ACTIVITY_SEVERITY_BADGE.SECURITY).toBe('destructive');
    expect(ACTIVITY_SEVERITY_BADGE.SECURITY).not.toBe(ACTIVITY_SEVERITY_BADGE.ERROR);
  });

  it('does not let a category decide urgency', () => {
    // A rose GRADE beside a neutral INFO is a routine grade entry, not an error. The maps
    // share no values, which is what keeps the two columns readable as two questions.
    const severities = new Set<string>(Object.values(ACTIVITY_SEVERITY_BADGE));
    for (const v of Object.values(ACTIVITY_CATEGORY_BADGE)) {
      expect(severities.has(v)).toBe(false);
    }
  });
});
