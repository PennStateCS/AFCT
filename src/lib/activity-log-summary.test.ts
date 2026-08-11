import { describe, expect, it } from 'vitest';
import { describeActivity, formatActivityDetails } from './activity-log-summary';

/**
 * Turning log metadata into a sentence.
 *
 * The reason this exists: the log listed an action name and hid everything else behind a
 * dialog, so "LTI ROSTER SYNCED" said nothing about whether six people were added or sixty
 * dropped. The tests are mostly about not saying more than the metadata supports.
 */

describe('a roster sync', () => {
  it('says what changed', () => {
    const summary = describeActivity('LTI_ROSTER_SYNCED', {
      added: 6,
      dropped: 3,
      restored: 0,
      accountsCreated: 6,
      identitiesLinked: 6,
    });

    expect(summary).toBe('6 added, 3 dropped, 6 new accounts, 6 sign-ins connected');
  });

  // A row of zeroes reads as noise and hides the ones that matter.
  it('leaves out the parts that did not happen', () => {
    const summary = describeActivity('LTI_ROSTER_SYNCED', { added: 2, dropped: 0, restored: 0 });

    expect(summary).toBe('2 added');
  });

  /** A sync that changed nothing is worth saying plainly, not as an empty line. */
  it('says so when nothing changed', () => {
    expect(describeActivity('LTI_ROSTER_SYNCED', { added: 0, dropped: 0 })).toBe('nothing changed');
  });
});

/**
 * A roster sync writes one of these per person, using the same actions as a change made by
 * hand. The summary says where it came from, so the two are distinguishable.
 */
describe('an enrolment change', () => {
  it('says when it came from a sync', () => {
    expect(describeActivity('DROP_FROM_COURSE', { via: 'LTI_ROSTER_SYNC' })).toBe(
      'from an LMS roster sync',
    );
  });

  it('says nothing for one done by hand', () => {
    expect(describeActivity('DROP_FROM_COURSE', { previousStatus: 'ENROLLED' })).toBeNull();
  });
});

/**
 * The gap the audit found: an update recorded which fields moved and what they are now, so
 * "who changed the due date" was answerable and "from when" was not.
 */
describe('an update', () => {
  it('says what moved and what it moved from', () => {
    const summary = describeActivity('UPDATE_ASSIGNMENT', {
      changes: { dueDate: { from: '2026-08-24', to: '2026-09-01' } },
    });

    expect(summary).toBe('Due date: 2026-08-24 to 2026-09-01');
  });

  it('says when something was set for the first time', () => {
    const summary = describeActivity('UPDATE_COURSE', {
      changes: { lateCutoff: { from: null, to: '2026-09-01' } },
    });

    expect(summary).toBe('Late cutoff: nothing to 2026-09-01');
  });

  // A save that changed nothing should not claim otherwise.
  it('says nothing when nothing moved', () => {
    expect(describeActivity('UPDATE_ASSIGNMENT', { changes: {} })).toBeNull();
  });
});

describe('a grade change', () => {
  it('gives the old mark and the new one', () => {
    expect(describeActivity('PROBLEM_GRADE_UPDATED', { previousGrade: 80, grade: 95 })).toBe(
      '80 to 95',
    );
  });

  // "null to 95" reads as a bug; it was simply not graded before.
  it('reads plainly for a first grade', () => {
    expect(describeActivity('PROBLEM_GRADE_UPDATED', { previousGrade: null, grade: 95 })).toBe(
      'graded 95',
    );
  });
});

describe('a role change', () => {
  it('gives both roles', () => {
    expect(describeActivity('CHANGE_COURSE_ROLE', { previousRole: 'STUDENT', newRole: 'TA' })).toBe(
      'STUDENT to TA',
    );
  });
});

describe('a refused launch', () => {
  it('gives the reason', () => {
    expect(describeActivity('LTI_LAUNCH_DENIED', { reason: 'bad-signature' })).toBe(
      'bad-signature',
    );
  });

  /**
   * The claimed issuer is exactly what an administrator compares against the registration, so
   * it belongs on the row rather than inside a dialog.
   */
  it('adds the issuer the token claimed, when there is one', () => {
    const summary = describeActivity('LTI_LAUNCH_DENIED', {
      reason: 'unregistered-platform',
      observedClaims: { issuer: 'Client', clientId: 'AFCT' },
    });

    expect(summary).toBe('unregistered-platform, claimed issuer Client');
  });
});

describe('an identity change', () => {
  it('says how it came about, in words', () => {
    const summary = describeActivity('IDENTITY_LINKED', {
      kind: 'LTI',
      via: 'JUST_IN_TIME',
      accountCreated: true,
    });

    expect(summary).toBe('LTI, created on first sign-in, new account');
  });

  it('does not claim an account was created when it was not', () => {
    const summary = describeActivity('IDENTITY_LINKED', { kind: 'OIDC', via: 'SELF_SERVICE' });

    expect(summary).toBe('OIDC, connected by the account holder');
  });

  // An unfamiliar value is passed through rather than dropped or guessed at.
  it('shows a method it does not recognise as it is', () => {
    expect(describeActivity('IDENTITY_LINKED', { kind: 'LTI', via: 'SOMETHING_NEW' })).toBe(
      'LTI, SOMETHING_NEW',
    );
  });
});

/**
 * The restraint that keeps this honest: an action with no case, or metadata missing the fields
 * a case needs, produces nothing rather than a sentence invented from whatever was there.
 */
describe('what it refuses to summarise', () => {
  it('says nothing for an action it does not know', () => {
    expect(describeActivity('SOMETHING_ELSE', { added: 5 })).toBeNull();
  });

  it('says nothing when the metadata is missing', () => {
    expect(describeActivity('LTI_PLATFORM_REGISTERED', null)).toBeNull();
    expect(describeActivity('LTI_LAUNCH_DENIED', {})).toBeNull();
  });
});

/**
 * The detail view. It replaced handing the viewer the raw row as JSON, which answered "what
 * happened" only if you could read a metadata blob.
 */
describe('the readable detail view', () => {
  const entry = {
    action: 'LTI_ROSTER_SYNCED',
    severity: 'WARNING',
    category: 'COURSE',
    ipAddress: '10.0.0.1',
    metadata: {
      added: 6,
      dropped: 3,
      userName: 'Marybelle Ryan',
      courseCode: 'CMPSC 464',
      accountsCreated: 6,
      userAgent: 'something long and useless',
    },
  };

  it('leads with what happened', () => {
    expect(formatActivityDetails(entry).startsWith('What happened\n6 added, 3 dropped')).toBe(true);
  });

  it('names the person and the course', () => {
    const text = formatActivityDetails(entry);

    expect(text).toContain('Marybelle Ryan');
    expect(text).toContain('CMPSC 464');
  });

  // camelCase is how the code spells it, not how anybody reads it.
  it('turns field names into words', () => {
    expect(formatActivityDetails(entry)).toContain('New accounts');
  });

  it('leaves out the user agent, which nobody reads', () => {
    expect(formatActivityDetails(entry)).not.toContain('something long and useless');
  });

  it('still works for an action it cannot summarise', () => {
    const text = formatActivityDetails({ action: 'SOMETHING_ELSE', metadata: { count: 2 } });

    expect(text).not.toContain('What happened');
    expect(text).toContain('SOMETHING ELSE');
    expect(text).toContain('Count');
  });
});
