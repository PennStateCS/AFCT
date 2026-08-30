import { describe, expect, it } from 'vitest';

import {
  isMissingZero,
  submittedKey,
  type MissingWorkAssignment,
  type MissingWorkParticipant,
  type MissingWorkProblem,
  type SubmittedIndex,
} from './missing-work';
import type { OverrideRow } from './effective-deadline';

const DUE = new Date('2026-03-01T23:59:00.000Z');
const AFTER = new Date('2026-03-02T09:00:00.000Z');
const BEFORE = new Date('2026-02-28T09:00:00.000Z');

const assignment = (over: Partial<MissingWorkAssignment> = {}): MissingWorkAssignment => ({
  missingWorkIsZero: true,
  isPublished: true,
  groupSetId: null,
  courseIsArchived: false,
  dueDate: DUE,
  unlockAt: null,
  lateCutoff: null,
  allowLateSubmissions: false,
  ...over,
});

const problem = (over: Partial<MissingWorkProblem> = {}): MissingWorkProblem => ({
  problemId: 'p1',
  maxPoints: 10,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...over,
});

const participant = (over: Partial<MissingWorkParticipant> = {}): MissingWorkParticipant => ({
  studentId: 'u1',
  isAssigned: true,
  isActive: true,
  groupIds: [],
  ...over,
});

const nothingSubmitted: SubmittedIndex = { byStudent: new Set(), byGroup: new Set() };

const submittedBy = (ownerId: string, problemId = 'p1', scope: 'student' | 'group' = 'student') =>
  scope === 'student'
    ? { byStudent: new Set([submittedKey(ownerId, problemId)]), byGroup: new Set<string>() }
    : { byStudent: new Set<string>(), byGroup: new Set([submittedKey(ownerId, problemId)]) };

/** The default call: everything on, deadline passed, nothing handed in, nothing graded. */
const verdict = (
  a = assignment(),
  p = participant(),
  s: SubmittedIndex = nothingSubmitted,
  hasGrade = false,
  overrides: OverrideRow[] = [],
  now = AFTER,
) => isMissingZero(a, problem(), p, overrides, s, hasGrade, now);

describe('the plain case', () => {
  it('scores unsubmitted work zero once the deadline has passed', () => {
    expect(verdict()).toEqual({ missing: true });
  });

  it('says nothing before the deadline', () => {
    expect(verdict(assignment(), participant(), nothingSubmitted, false, [], BEFORE)).toEqual({
      missing: false,
      reason: 'not-due-yet',
    });
  });

  it('is silent while the setting is off', () => {
    expect(verdict(assignment({ missingWorkIsZero: false }))).toEqual({
      missing: false,
      reason: 'setting-off',
    });
  });
});

describe('work that was handed in', () => {
  it('is never zero, whoever is waiting to mark it', () => {
    // The rule keys on whether anything was submitted, not on how the problem is graded. This is
    // the case that matters most: the student did their part and the queue is ours.
    expect(verdict(assignment(), participant(), submittedBy('u1'))).toEqual({
      missing: false,
      reason: 'submitted',
    });
  });

  it('counts a groupmate submitting as the whole group submitting', () => {
    const groupWork = assignment({ groupSetId: 'gs1' });
    const member = participant({ studentId: 'u2', groupIds: ['g1'] });

    expect(verdict(groupWork, member, submittedBy('g1', 'p1', 'group'))).toEqual({
      missing: false,
      reason: 'submitted',
    });
  });

  it('still sees an individual attempt on an assignment that later became group work', () => {
    const groupWork = assignment({ groupSetId: 'gs1' });
    const member = participant({ groupIds: ['g1'] });

    expect(verdict(groupWork, member, submittedBy('u1'))).toEqual({
      missing: false,
      reason: 'submitted',
    });
  });
});

describe('a recorded grade always wins', () => {
  it('leaves work a person marked alone, even with no submission', () => {
    // Staff can mark work that never came through AFCT at all. Overriding that would be a
    // calendar overruling a person.
    expect(verdict(assignment(), participant(), nothingSubmitted, true)).toEqual({
      missing: false,
      reason: 'graded',
    });
  });
});

describe('who is even eligible', () => {
  it('exempts a student the work was never assigned to', () => {
    expect(verdict(assignment(), participant({ isAssigned: false }))).toEqual({
      missing: false,
      reason: 'not-assigned',
    });
  });

  it('exempts a dropped student or a deactivated account', () => {
    expect(verdict(assignment(), participant({ isActive: false }))).toEqual({
      missing: false,
      reason: 'not-active',
    });
  });

  it('exempts a student who is in no group on group work', () => {
    // They had no way to submit at all, so a zero would be punishing them for our setup.
    const groupWork = assignment({ groupSetId: 'gs1' });

    expect(verdict(groupWork, participant({ groupIds: [] }))).toEqual({
      missing: false,
      reason: 'no-group',
    });
  });

  it('says nothing about an unpublished assignment', () => {
    expect(verdict(assignment({ isPublished: false }))).toEqual({
      missing: false,
      reason: 'unpublished',
    });
  });

  it('leaves archived courses alone', () => {
    expect(verdict(assignment({ courseIsArchived: true }))).toEqual({
      missing: false,
      reason: 'archived',
    });
  });

  it('skips a problem worth nothing', () => {
    const free = problem({ maxPoints: 0 });

    expect(
      isMissingZero(assignment(), free, participant(), [], nothingSubmitted, false, AFTER),
    ).toEqual({ missing: false, reason: 'zero-points' });
  });

  it('skips a problem attached after the deadline had passed', () => {
    // Adding a problem to an overdue assignment would otherwise mark the whole class missing for
    // work that did not exist when their deadline went by.
    const late = problem({ createdAt: new Date('2026-03-05T00:00:00.000Z') });

    expect(
      isMissingZero(assignment(), late, participant(), [], nothingSubmitted, false, AFTER),
    ).toEqual({ missing: false, reason: 'added-after-deadline' });
  });
});

/**
 * The half of this that is easiest to get wrong. Submission is a group fact and the deadline is a
 * personal one, so a group assignment is not one date, and evaluating it per group rather than per
 * member would take an extension away from the person it was granted to.
 */
describe('extensions, including on group work', () => {
  const studentOverride = (userId: string, dueDate: Date): OverrideRow => ({
    targetType: 'STUDENT',
    userId,
    groupId: null,
    unlockAt: null,
    dueDate,
    lateCutoff: null,
    allowLateSubmissions: null,
  });

  const groupOverride = (groupId: string, dueDate: Date): OverrideRow => ({
    targetType: 'GROUP',
    userId: null,
    groupId,
    unlockAt: null,
    dueDate,
    lateCutoff: null,
    allowLateSubmissions: null,
  });

  const NEXT_WEEK = new Date('2026-03-08T23:59:00.000Z');

  it('leaves a student with an extension alone while everyone else is zeroed', () => {
    const extended = [studentOverride('u1', NEXT_WEEK)];

    expect(verdict(assignment(), participant(), nothingSubmitted, false, extended)).toEqual({
      missing: false,
      reason: 'not-due-yet',
    });
    // Their classmate, on the same assignment, still is.
    expect(
      verdict(assignment(), participant({ studentId: 'u2' }), nothingSubmitted, false, extended),
    ).toEqual({ missing: true });
  });

  it('gives one member of a group an extension without giving it to the group', () => {
    const groupWork = assignment({ groupSetId: 'gs1' });
    const extended = [studentOverride('u1', NEXT_WEEK)];
    const inGroup = (studentId: string) => participant({ studentId, groupIds: ['g1'] });

    // The member who was granted it keeps their blank.
    expect(verdict(groupWork, inGroup('u1'), nothingSubmitted, false, extended)).toEqual({
      missing: false,
      reason: 'not-due-yet',
    });
    // Their groupmates, who were not, take the zero. That is what granting it to one person meant.
    expect(verdict(groupWork, inGroup('u2'), nothingSubmitted, false, extended)).toEqual({
      missing: true,
    });
  });

  it('honours an extension given to the whole group', () => {
    const groupWork = assignment({ groupSetId: 'gs1' });
    const extended = [groupOverride('g1', NEXT_WEEK)];

    expect(
      verdict(groupWork, participant({ groupIds: ['g1'] }), nothingSubmitted, false, extended),
    ).toEqual({ missing: false, reason: 'not-due-yet' });
  });
});

describe('the late window', () => {
  it('zeroes at the due date even while late work is still accepted', () => {
    // Settled deliberately: the student sees the consequence while they can still act on it, and
    // their late submission replaces the zero when it arrives.
    const lateAllowed = assignment({
      allowLateSubmissions: true,
      lateCutoff: new Date('2026-03-15T23:59:00.000Z'),
    });

    expect(verdict(lateAllowed)).toEqual({ missing: true });
  });
});
