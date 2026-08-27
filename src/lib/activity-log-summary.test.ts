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

describe('an audience change', () => {
  it('says when everybody gets it', () => {
    expect(describeActivity('UPDATE_ASSIGNMENT_AUDIENCE', { assignedToEveryone: true })).toBe(
      'assigned to everyone',
    );
  });

  it('counts the people it was narrowed to', () => {
    const summary = describeActivity('UPDATE_ASSIGNMENT_AUDIENCE', {
      assignedToEveryone: false,
      assigneeCount: 3,
      assigneeKind: 'student',
    });

    expect(summary).toBe('assigned to 3 students');
  });

  it('reads properly for one', () => {
    const summary = describeActivity('UPDATE_ASSIGNMENT_AUDIENCE', {
      assignedToEveryone: false,
      assigneeCount: 1,
      assigneeKind: 'group',
    });

    expect(summary).toBe('assigned to 1 group');
  });
});

describe('a group membership change', () => {
  it('says how many moved each way', () => {
    const summary = describeActivity('UPDATE_GROUP_SET_MEMBERSHIPS', {
      assignedCount: 4,
      removedCount: 2,
    });

    expect(summary).toBe('4 moved into a group, 2 taken out');
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

  // The claimed issuer is what an administrator compares against the registration, so it
  // belongs on the row rather than inside a dialog.
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

  it('leads with what happened, as a sentence rather than the column fragment', () => {
    // The table can afford a fragment because the action is in the column beside it. Here it
    // is on its own under a heading, so it says who did what.
    expect(
      formatActivityDetails({ ...entry, userDisplayName: 'Ada Lovelace' }).startsWith(
        'What happened\nAda Lovelace synced lti roster, 6 added, 3 dropped',
      ),
    ).toBe(true);
  });

  /*
   * The actor is the entry's own user, never metadata.userName. Those differ whenever an
   * action is done TO somebody: this fixture records Marybelle Ryan as the person the roster
   * sync was about, and a sentence naming her as having done it would be a false statement in
   * an audit record.
   */
  it('never builds the sentence from a name in the metadata', () => {
    const text = formatActivityDetails(entry);

    expect(text).toContain('What happened\nSynced lti roster');
    expect(text).not.toContain('Marybelle Ryan synced');
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

/** Failing actions already carry the reason, so this needs no per-action case. */
describe('a failed action', () => {
  it('reads the reason a guard turned it down', () => {
    expect(describeActivity('COURSE_UPDATE_DENIED', { reason: 'not course staff' })).toBe(
      'not course staff',
    );
  });

  it('falls back to the caught error when there is no reason', () => {
    expect(describeActivity('ASSIGNMENT_UPDATE_ERROR', { error: 'connection lost' })).toBe(
      'connection lost',
    );
  });

  it('prefers the reason, which is the deliberate one', () => {
    const text = describeActivity('X_DENIED', { reason: 'archived', error: 'ignored' });

    expect(text).toBe('archived');
  });

  // The suffix gate: a successful action carrying a `reason` must not read as a failure.
  it('does not fire on an action that did not fail', () => {
    expect(describeActivity('CREATE_COURSE', { reason: 'because I wanted to' })).toBeNull();
  });

  it('says nothing when the action failed without recording why', () => {
    expect(describeActivity('SOMETHING_ERROR', { courseId: 'c-1' })).toBeNull();
  });

  // The updater reports its outcome under `message`.
  it('reads a failed update outcome', () => {
    const text = describeActivity('SYSTEM_UPDATE_FAILED', {
      phase: 'failed',
      message: 'health check timed out',
    });

    expect(text).toBe('health check timed out');
  });
});

/** The refusals the auth wrappers log. SECURITY entries, so they have to say why. */
describe('a refused request', () => {
  it('describes a course refusal from the standard wrapper metadata', () => {
    const text = describeActivity('ROSTER_VIEW_DENIED', {
      reason: 'student, needs faculty or ta',
      required: 'FACULTY or TA',
      role: 'STUDENT',
    });

    expect(text).toBe('student, needs faculty or ta');
  });

  it('describes an admin refusal', () => {
    expect(describeActivity('ADMIN_BACKUPS_VIEW_DENIED', { reason: 'not an administrator' })).toBe(
      'not an administrator',
    );
  });

  // Not every failure name ends in _ERROR or _DENIED.
  it('covers the failures whose names do not end in the usual way', () => {
    expect(describeActivity('SUBMISSION_UNAUTHORIZED', { reason: 'not signed in' })).toBe(
      'not signed in',
    );
    expect(
      describeActivity('GROUP_SET_MEMBERSHIP_CONFLICT', { reason: 'group set changed' }),
    ).toBe('group set changed');
  });
});

/** How somebody got in. Otherwise every sign-in row reads the same. */
describe('a sign-in', () => {
  it('tells an LMS launch apart from a password', () => {
    expect(describeActivity('LOGIN_SUCCESS', { provider: 'lti-launch' })).toBe('from an LMS');
    expect(describeActivity('LOGIN_SUCCESS', { provider: 'credentials' })).toBe(
      'with an AFCT password',
    );
    expect(describeActivity('LOGIN_SUCCESS', { provider: 'oidc' })).toBe(
      'with institutional sign-in',
    );
  });

  it('says when a temporary password was used', () => {
    const text = describeActivity('LOGIN_SUCCESS', {
      provider: 'credentials',
      temporaryPasswordLogin: true,
    });

    expect(text).toBe('with an AFCT password, temporary password');
  });

  // A provider added later should not read as though nothing happened.
  it('says nothing for a provider it does not know', () => {
    expect(describeActivity('LOGIN_SUCCESS', { provider: 'saml' })).toBeNull();
  });

  it('covers the native client the same way', () => {
    expect(describeActivity('CLIENT_LOGIN', { provider: 'credentials' })).toBe(
      'with an AFCT password',
    );
  });
});

/** A deep link is only interesting for which assignment it points at. */
describe('a deep link returned to the LMS', () => {
  it('names the assignment', () => {
    expect(
      describeActivity('LTI_DEEP_LINK_RETURNED', { assignmentTitle: 'LMS sync demo' }),
    ).toBe('linked to LMS sync demo');
  });

  it('says nothing when the title was not recorded', () => {
    expect(describeActivity('LTI_DEEP_LINK_RETURNED', { issuer: 'Client' })).toBeNull();
  });
});

/**
 * What an entry is about.
 *
 * The course, assignment, problem and submission live in columns on the row rather than in
 * metadata, so this view simply did not show them: somebody reading an entry about a grade could
 * not tell which assignment it was for without going and looking the id up elsewhere.
 */
describe('the records an entry points at', () => {
  const entry = (related: Record<string, string | null> | null) =>
    formatActivityDetails({
      action: 'PROBLEM_GRADE_UPDATED',
      metadata: { grade: 8, previousGrade: 5 },
      related,
    });

  it('names them rather than showing identifiers', () => {
    const text = entry({
      course: 'CMPSC 464, Theory of Computation',
      assignment: 'Problem set 1',
      problem: 'Deterministic finite automata',
    });

    expect(text).toContain('About');
    expect(text).toContain('CMPSC 464, Theory of Computation');
    expect(text).toContain('Problem set 1');
    expect(text).toContain('Deterministic finite automata');
  });

  // A record deleted since resolves to nothing, and a heading over an empty list is worse than
  // no heading.
  it('leaves the section out when the entry points at nothing', () => {
    expect(entry(null)).not.toContain('About');
    expect(entry({ course: null, assignment: null })).not.toContain('About');
  });

  it('shows only the parts that resolved', () => {
    const text = entry({ course: 'CMPSC 464, Theory', assignment: null, problem: null });

    expect(text).toContain('CMPSC 464, Theory');
    expect(text).not.toContain('Assignment');
  });

  /** A submission has no title of its own, so its id is what somebody would search for. */
  it('falls back to the identifier for a submission', () => {
    expect(entry({ submission: 'sub-123' })).toContain('sub-123');
  });

  // It sits above the raw metadata: what the entry is about is read more often than the fields
  // the action happened to record.
  it('comes before the details', () => {
    const text = entry({ course: 'CMPSC 464, Theory' });

    expect(text.indexOf('About')).toBeLessThan(text.indexOf('Details'));
  });
});

/**
 * Looking at a student's work.
 *
 * These carry the most weight of anything here: under FERPA the log is the disclosure record,
 * and "a member of staff opened something" is weak evidence next to "a member of staff opened
 * one student's submissions from the review workspace".
 */
describe('access to student records', () => {
  it('says how much was seen and where from', () => {
    expect(describeActivity('VIEW_STUDENT_SUBMISSION', { source: 'client' })).toBe(
      'one student, from the desktop client',
    );
    expect(describeActivity('VIEW_STUDENT_REVIEW_DATA', { source: 'review-data' })).toBe(
      'one student, from the review workspace',
    );
  });

  // The code's own label would leak into a sentence a person reads.
  it('falls back to the raw source rather than dropping it', () => {
    expect(describeActivity('VIEW_STUDENT_SUBMISSION', { source: 'something-new' })).toBe(
      'one student, from something-new',
    );
  });

  /**
   * No student is named. The row already points at them through `targetUserId`, and a name in a
   * column read over somebody's shoulder is its own small disclosure.
   */
  it('never names the student', () => {
    const summary = describeActivity('VIEW_STUDENT_SUBMISSION', {
      viewedStudentId: 'u-123',
      studentName: 'Ada Lovelace',
      source: 'web',
    });

    expect(summary).not.toContain('Ada');
    expect(summary).not.toContain('u-123');
  });

  // One student's work and a whole assignment's are different disclosures.
  it('tells one student apart from the whole assignment', () => {
    expect(describeActivity('VIEW_ASSIGNMENT_SUBMISSIONS', { viewedStudentId: 'u-1' })).toBe(
      "one student's submissions",
    );
    expect(describeActivity('VIEW_ASSIGNMENT_SUBMISSIONS', { assignmentId: 'a-1' })).toBe(
      'the whole assignment',
    );
  });

  it('counts an export', () => {
    expect(
      describeActivity('GRADES_EXPORTED', {
        studentCount: 34,
        assignmentCount: 6,
        platform: 'canvas',
      }),
    ).toBe('34 students, 6 assignments, for canvas');
  });

  it('says when an export was the whole gradebook', () => {
    expect(
      describeActivity('GRADES_EXPORTED', { studentCount: 34, wholeGradebook: true }),
    ).toBe('34 students, whole gradebook');
  });
});

describe('grades and attempts', () => {
  it('says what a group was given and how many it reached', () => {
    expect(
      describeActivity('GROUP_PROBLEM_GRADE_UPDATED', {
        groupName: 'Group A',
        grade: 8,
        memberIds: ['u1', 'u2', 'u3'],
      }),
    ).toBe('Group A, graded 8, 3 members');
  });

  /**
   * The case worth surfacing: grading a group overwrote marks that were not all the same, so an
   * individual's grade changed as a side effect. A student disputing theirs needs that visible.
   */
  it('flags a group grade that replaced differing marks', () => {
    const summary = describeActivity('GROUP_PROBLEM_GRADE_UPDATED', {
      groupName: 'Group A',
      grade: 8,
      memberIds: ['u1', 'u2'],
      overwroteDiffering: true,
    });

    expect(summary).toContain('replaced differing marks');
  });

  it('says which way an attempt grant went, and why', () => {
    expect(
      describeActivity('GRANT_EXTRA_SUBMISSIONS', {
        extraSubmissions: 2,
        totalExtraSubmissions: 5,
        targetType: 'STUDENT',
        reason: 'illness',
      }),
    ).toBe('+2 attempts for one student (5 in total): illness');

    expect(
      describeActivity('REVOKE_EXTRA_SUBMISSIONS', { extraSubmissions: 1, targetType: 'GROUP' }),
    ).toBe('-1 attempt for a group');
  });

  it('says how many submissions a bulk re-run touched', () => {
    expect(describeActivity('COURSE_SUBMISSIONS_RERUN', { count: 42 })).toBe(
      '42 submissions re-run',
    );
  });
});

describe('accounts and enrolment', () => {
  it('names the account a create or delete was about', () => {
    expect(describeActivity('CREATE_USER', { createdUserEmail: 'a@b.test' })).toBe('a@b.test');
    expect(describeActivity('DELETE_USER', { deletedUserEmail: 'gone@b.test' })).toBe(
      'gone@b.test',
    );
  });

  it('counts a bulk enrolment', () => {
    expect(describeActivity('BULK_ENROLL_USERS', { enrolledCount: 12, reEnrolledCount: 3 })).toBe(
      '12 enrolled, 3 re-enrolled',
    );
  });

  it('says plainly when a bulk enrolment did nothing', () => {
    expect(describeActivity('BULK_ENROLL_USERS', { enrolledCount: 0 })).toBe('nobody enrolled');
  });

  // The difference between a real reset request and a probe at an address with no account.
  it('says whether a reset link was actually sent', () => {
    expect(describeActivity('PASSWORD_RESET_REQUESTED', { queued: true })).toBe('a link was sent');
    expect(describeActivity('PASSWORD_RESET_REQUESTED', { queued: false })).toBe(
      'no account, nothing sent',
    );
  });

  it('says whether an unlocked account was locked in the first place', () => {
    expect(describeActivity('UNLOCK_ACCOUNT', { wasLocked: true })).toBe('was locked out');
    expect(describeActivity('UNLOCK_ACCOUNT', { wasLocked: false })).toBe('was not locked');
  });
});

describe('courses and their contents', () => {
  /** A deleted course takes its assignments, problems and enrolments with it. */
  it('says how much a course deletion destroyed', () => {
    expect(
      describeActivity('DELETE_COURSE', {
        courseCode: 'CMPSC 464',
        courseName: 'Theory',
        assignmentCount: 8,
        problemCount: 40,
        studentCount: 31,
      }),
    ).toBe('CMPSC 464, Theory, with 8 assignments, 40 problems, 31 students');
  });

  // Adding a problem to an assignment students have already worked on is worth flagging.
  it('flags problems added to an assignment that already has submissions', () => {
    const summary = describeActivity('ADD_ASSIGNMENT_PROBLEMS', {
      addedProblemIds: ['p1', 'p2'],
      linksWithSubmissions: 1,
    });

    expect(summary).toBe('2 problems added, 1 already has submissions');
  });

  it('says which way an assignment type changed', () => {
    expect(describeActivity('CHANGE_ASSIGNMENT_TYPE', { isGroup: true })).toBe(
      'to a group assignment',
    );
    expect(describeActivity('CHANGE_ASSIGNMENT_TYPE', { isGroup: false })).toBe(
      'to an individual assignment',
    );
  });

  it('says what a group was renamed from', () => {
    expect(
      describeActivity('UPDATE_GROUP_SET_GROUP', { previousName: 'Group A', name: 'Team A' }),
    ).toBe('Group A to Team A');
  });
});

describe('the system itself', () => {
  it('says which version an update was going to', () => {
    expect(describeActivity('SYSTEM_UPDATE_REQUESTED', { fromTag: 'v0.3.0', tag: 'v0.4.0' })).toBe(
      'v0.3.0 to v0.4.0',
    );
  });

  it('marks a forced downgrade as forced', () => {
    expect(
      describeActivity('SYSTEM_DOWNGRADE_REQUESTED', {
        fromTag: 'v0.4.0',
        tag: 'v0.3.0',
        forced: true,
      }),
    ).toBe('v0.4.0 to v0.3.0, forced');
  });

  /**
   * Settings changes record whether a secret moved, never its value. The summary has to keep
   * that property: it is read by more people than the detail dialog.
   */
  it('reports a secret as changed without repeating it', () => {
    const summary = describeActivity('SYSTEM_SETTINGS_UPDATED', {
      smtpPasswordUpdated: true,
      smtpPassword: 'hunter2',
    });

    expect(summary).toBe('mail password set');
    expect(summary).not.toContain('hunter2');
  });
});

/**
 * The rule this module is built on: say nothing rather than invent. An action whose metadata
 * carries no change has no summary, and the column stays empty.
 */
describe('what deliberately has no summary', () => {
  it.each([
    'VIEW_USERS',
    'VIEW_ASSIGNMENT_PROBLEMS',
    'SYSTEM_BACKUP_REQUESTED',
  ])('%s says nothing, because there is nothing to add', (action) => {
    expect(describeActivity(action, { userId: 'u-1' })).toBeNull();
  });

  it('says nothing for an action it has never heard of', () => {
    expect(describeActivity('SOME_FUTURE_ACTION', { anything: 'at all' })).toBeNull();
  });

  // A failure still reports why, matched on the name so a new one needs no case.
  it('still reports why a failure failed', () => {
    expect(describeActivity('COURSE_CREATE_ERROR', { error: 'duplicate code' })).toBe(
      'duplicate code',
    );
  });
});

describe('the entries an administrator reads after the fact', () => {
  it('says which versions a finished update moved between', () => {
    expect(
      describeActivity('SYSTEM_UPDATE_COMPLETED', { fromTag: 'v0.8.3', toTag: 'v0.8.4' }),
    ).toBe('v0.8.3 to v0.8.4');
  });

  it('reports the version a rollback ended on, not the one it was trying for', () => {
    expect(
      describeActivity('SYSTEM_UPDATE_ROLLED_BACK', { fromTag: 'v0.8.3', toTag: 'v0.8.4' }),
    ).toBe('v0.8.4 failed, back on v0.8.3');
  });

  it('still names the version when only one end of the move was recorded', () => {
    expect(describeActivity('SYSTEM_UPDATE_COMPLETED', { toTag: 'v0.8.4' })).toBe('now on v0.8.4');
    expect(describeActivity('SYSTEM_UPDATE_COMPLETED', { requestId: 'r-1' })).toBeNull();
  });

  it('says which kind of session a sign-out ended', () => {
    expect(describeActivity('LOGOUT', { provider: 'oidc' })).toBe(
      'ended an institutional sign-in session',
    );
    expect(describeActivity('LOGOUT', { provider: 'credentials' })).toBe(
      'ended a password session',
    );
    expect(describeActivity('CLIENT_LOGOUT', { provider: 'lti-launch' })).toBe(
      'ended a session that came from an LMS',
    );
  });

  // Sessions started before the provider was carried on the token, which is most of what is
  // in the log on the machine this was written for.
  it('still records a sign-out whose session never said where it came from', () => {
    expect(describeActivity('LOGOUT', { userId: 'u-1' })).toBe('signed out');
    expect(describeActivity('LOGOUT', { provider: 'something-new' })).toBe('signed out');
  });

  it('names the way in that an unlink took away', () => {
    expect(
      describeActivity('IDENTITY_UNLINKED', { kind: 'OIDC', issuer: 'https://idp.example.edu' }),
    ).toBe('OIDC at https://idp.example.edu removed');
  });

  it('still reports an unlink recorded before the issuer was kept', () => {
    expect(describeActivity('IDENTITY_UNLINKED', { targetUserId: 'u-1', identityId: 'li-1' })).toBe(
      'a way in was removed',
    );
  });
});
