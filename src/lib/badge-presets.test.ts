import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_CATEGORY_BADGE,
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
