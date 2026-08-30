import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  activityDetail,
  describeActivity,
  describeActivitySentence,
  displayIpAddress,
  formatActivityDetails,
  objectPhrase,
} from './activity-log-summary';

/**
 * Turning log metadata into a sentence.
 *
 * The reason this exists: the log listed an action name and hid everything else behind a
 * dialog, so "LTI ROSTER SYNCED" said nothing about whether six people were added or sixty
 * dropped. The tests are mostly about not saying more than the metadata supports.
 */

describe('a roster sync', () => {
  it('says what changed', () => {
    const summary = activityDetail('LTI_ROSTER_SYNCED', {
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
    const summary = activityDetail('LTI_ROSTER_SYNCED', { added: 2, dropped: 0, restored: 0 });

    expect(summary).toBe('2 added');
  });

  /** A sync that changed nothing is worth saying plainly, not as an empty line. */
  it('says so when nothing changed', () => {
    expect(activityDetail('LTI_ROSTER_SYNCED', { added: 0, dropped: 0 })).toBe('nothing changed');
  });
});

/**
 * A roster sync writes one of these per person, using the same actions as a change made by
 * hand. The summary says where it came from, so the two are distinguishable.
 */
describe('an enrolment change', () => {
  it('says when it came from a sync', () => {
    expect(activityDetail('DROP_FROM_COURSE', { via: 'LTI_ROSTER_SYNC' })).toBe(
      'from an LMS roster sync',
    );
  });

  it('says nothing for one done by hand', () => {
    expect(activityDetail('DROP_FROM_COURSE', { previousStatus: 'ENROLLED' })).toBeNull();
  });
});

/**
 * The gap the audit found: an update recorded which fields moved and what they are now, so
 * "who changed the due date" was answerable and "from when" was not.
 */
describe('an update', () => {
  it('says what moved and what it moved from', () => {
    const summary = activityDetail('UPDATE_ASSIGNMENT', {
      changes: { dueDate: { from: '2026-08-24', to: '2026-09-01' } },
    });

    expect(summary).toBe('Due date: 2026-08-24 to 2026-09-01');
  });

  it('says when something was set for the first time', () => {
    const summary = activityDetail('UPDATE_COURSE', {
      changes: { lateCutoff: { from: null, to: '2026-09-01' } },
    });

    expect(summary).toBe('Late cutoff: nothing to 2026-09-01');
  });

  // A save that changed nothing should not claim otherwise.
  it('says nothing when nothing moved', () => {
    expect(activityDetail('UPDATE_ASSIGNMENT', { changes: {} })).toBeNull();
  });
});

describe('a grade change', () => {
  it('gives the old mark and the new one', () => {
    expect(activityDetail('PROBLEM_GRADE_UPDATED', { previousGrade: 80, grade: 95 })).toBe(
      '80 to 95',
    );
  });

  // "null to 95" reads as a bug; it was simply not graded before.
  it('reads plainly for a first grade', () => {
    expect(activityDetail('PROBLEM_GRADE_UPDATED', { previousGrade: null, grade: 95 })).toBe(
      'graded 95',
    );
  });
});

describe('an audience change', () => {
  it('says when everybody gets it', () => {
    expect(activityDetail('UPDATE_ASSIGNMENT_AUDIENCE', { assignedToEveryone: true })).toBe(
      'assigned to everyone',
    );
  });

  it('counts the people it was narrowed to', () => {
    const summary = activityDetail('UPDATE_ASSIGNMENT_AUDIENCE', {
      assignedToEveryone: false,
      assigneeCount: 3,
      assigneeKind: 'student',
    });

    expect(summary).toBe('assigned to 3 students');
  });

  it('reads properly for one', () => {
    const summary = activityDetail('UPDATE_ASSIGNMENT_AUDIENCE', {
      assignedToEveryone: false,
      assigneeCount: 1,
      assigneeKind: 'group',
    });

    expect(summary).toBe('assigned to 1 group');
  });
});

describe('a group membership change', () => {
  it('says how many moved each way', () => {
    const summary = activityDetail('UPDATE_GROUP_SET_MEMBERSHIPS', {
      assignedCount: 4,
      removedCount: 2,
    });

    expect(summary).toBe('4 moved into a group, 2 taken out');
  });
});

describe('a role change', () => {
  it('gives both roles', () => {
    expect(activityDetail('CHANGE_COURSE_ROLE', { previousRole: 'STUDENT', newRole: 'TA' })).toBe(
      'STUDENT to TA',
    );
  });
});

describe('a refused launch', () => {
  it('gives the reason', () => {
    expect(activityDetail('LTI_LAUNCH_DENIED', { reason: 'bad-signature' })).toBe('bad-signature');
  });

  // The claimed issuer is what an administrator compares against the registration, so it
  // belongs on the row rather than inside a dialog.
  it('adds the issuer the token claimed, when there is one', () => {
    const summary = activityDetail('LTI_LAUNCH_DENIED', {
      reason: 'unregistered-platform',
      observedClaims: { issuer: 'Client', clientId: 'AFCT' },
    });

    expect(summary).toBe('unregistered-platform, claimed issuer Client');
  });
});

describe('an identity change', () => {
  it('says how it came about, in words', () => {
    const summary = activityDetail('IDENTITY_LINKED', {
      kind: 'LTI',
      via: 'JUST_IN_TIME',
      accountCreated: true,
    });

    expect(summary).toBe('LTI, created on first sign-in, new account');
  });

  it('does not claim an account was created when it was not', () => {
    const summary = activityDetail('IDENTITY_LINKED', { kind: 'OIDC', via: 'SELF_SERVICE' });

    expect(summary).toBe('OIDC, connected by the account holder');
  });

  // An unfamiliar value is passed through rather than dropped or guessed at.
  it('shows a method it does not recognise as it is', () => {
    expect(activityDetail('IDENTITY_LINKED', { kind: 'LTI', via: 'SOMETHING_NEW' })).toBe(
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
    expect(activityDetail('SOMETHING_ELSE', { added: 5 })).toBeNull();
  });

  it('says nothing when the metadata is missing', () => {
    expect(activityDetail('LTI_PLATFORM_REGISTERED', null)).toBeNull();
    expect(activityDetail('LTI_LAUNCH_DENIED', {})).toBeNull();
  });
});

/**
 * The detail view. It replaced handing the viewer the raw row as JSON, which answered "what
 * happened" only if you could read a metadata blob.
 */
/**
 * Which file, on every action that serves one.
 *
 * The submission ones were missing, so an entry recording a member of staff opening a
 * student's work said "VIEW SUBMISSION FILE" and nothing else. That entry is a disclosure
 * record under FERPA, and it has to say what was disclosed.
 */
describe('files that were opened', () => {
  const meta = { fileName: 'a3f9c2-uuid.jff', originalFileName: 'flipflops.jff' };

  it.each([
    'VIEW_SUBMISSION_FILE',
    'DOWNLOAD_SUBMISSION_FILE',
    'VIEW_SOLUTION_FILE',
    'DOWNLOAD_SOLUTION_FILE',
    'VIEW_PROBLEM_FILE',
  ])('names the file in %s', (action) => {
    // The name the person who uploaded it chose, not the stored uuid.
    expect(activityDetail(action, meta)).toBe('flipflops.jff');
  });

  it('falls back to the stored name when there is no original', () => {
    expect(activityDetail('VIEW_SUBMISSION_FILE', { fileName: 'a3f9c2-uuid.jff' })).toBe(
      'a3f9c2-uuid.jff',
    );
  });

  it('reads as a sentence with a verb in it', () => {
    // DOWNLOAD had no past tense, so a download said "Ada flipflops.jff".
    expect(
      describeActivitySentence({
        action: 'DOWNLOAD_SUBMISSION_FILE',
        metadata: meta,
        userDisplayName: 'Ada Lovelace',
      }),
    ).toBe('Ada Lovelace · Downloaded · flipflops.jff');
  });
});

/**
 * Which course, which assignment.
 *
 * These two entries live on the log's relation columns rather than in metadata, so a summary
 * built from metadata alone could only ever say how many students were on the page. Both are
 * reads of student data, and an access record that cannot say whose data was read is not
 * doing its job.
 */
describe('entries that answer "which one"', () => {
  const related = {
    course: 'CMPEN 271, Introduction to Digital Systems',
    assignment: 'Flip Flops',
  };

  it('names the course whose gradebook was opened', () => {
    // The whole course, because here the course IS the object rather than context for one.
    expect(describeActivity('COURSE_GRADES_VIEWED', { studentCount: 17 }, related)).toBe(
      'Course grades for CMPEN 271, Introduction to Digital Systems · 17 students',
    );
  });

  it('still says something when the count is missing or the course has gone', () => {
    expect(describeActivity('COURSE_GRADES_VIEWED', {}, related)).toBe(
      'Course grades for CMPEN 271, Introduction to Digital Systems',
    );
    // A historical entry with no resolved course still says what was looked at and how big it
    // was. This is the shape most old rows take, and it must never render blank.
    expect(describeActivity('COURSE_GRADES_VIEWED', { studentCount: 17 }, null)).toBe(
      'Course grades · 17 students',
    );
  });

  it('names the assignment and its course for a similarity report', () => {
    expect(describeActivity('ASSIGNMENT_SIMILARITY_VIEWED', { matchGroups: 3 }, related)).toBe(
      'Similarity report for Flip Flops in CMPEN 271 · 3 match groups',
    );
  });

  it('reads as one sentence once the detail view puts a verb in front', () => {
    expect(
      describeActivitySentence({
        action: 'COURSE_GRADES_VIEWED',
        metadata: { studentCount: 17 },
        related,
        userDisplayName: 'Ada Lovelace',
      }),
    ).toBe(
      'Ada Lovelace · Viewed · Course grades for CMPEN 271, Introduction to Digital Systems · 17 students',
    );
  });
});

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
        'What happened\nAda Lovelace · Synced · Roster for CMPSC 464 · 6 added, 3 dropped',
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

    expect(text).toContain('What happened\nSynced · Roster');
    expect(text).not.toContain('Marybelle Ryan · Synced');
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

  /*
   * A future action nobody has written a rule for. It still gets a readable verb, which is the
   * forward-compatibility requirement: the row must never render blank.
   */
  it('still works for an action it cannot summarise', () => {
    const text = formatActivityDetails({ action: 'SOMETHING_ELSE', metadata: { count: 2 } });

    expect(text).toContain('What happened\nSomething else');
    expect(text).toContain('SOMETHING ELSE');
    expect(text).toContain('Count');
  });
});

/** Failing actions already carry the reason, so this needs no per-action case. */
describe('a failed action', () => {
  it('reads the reason a guard turned it down', () => {
    expect(activityDetail('COURSE_UPDATE_DENIED', { reason: 'not course staff' })).toBe(
      'not course staff',
    );
  });

  it('falls back to the caught error when there is no reason', () => {
    expect(activityDetail('ASSIGNMENT_UPDATE_ERROR', { error: 'connection lost' })).toBe(
      'connection lost',
    );
  });

  it('prefers the reason, which is the deliberate one', () => {
    const text = activityDetail('X_DENIED', { reason: 'archived', error: 'ignored' });

    expect(text).toBe('archived');
  });

  // The suffix gate: a successful action carrying a `reason` must not read as a failure.
  it('does not fire on an action that did not fail', () => {
    expect(activityDetail('CREATE_COURSE', { reason: 'because I wanted to' })).toBeNull();
  });

  it('says nothing when the action failed without recording why', () => {
    expect(activityDetail('SOMETHING_ERROR', { courseId: 'c-1' })).toBeNull();
  });

  // The updater reports its outcome under `message`.
  it('reads a failed update outcome', () => {
    const text = activityDetail('SYSTEM_UPDATE_FAILED', {
      phase: 'failed',
      message: 'health check timed out',
    });

    expect(text).toBe('health check timed out');
  });
});

/** The refusals the auth wrappers log. SECURITY entries, so they have to say why. */
describe('a refused request', () => {
  it('describes a course refusal from the standard wrapper metadata', () => {
    const text = activityDetail('ROSTER_VIEW_DENIED', {
      reason: 'student, needs faculty or ta',
      required: 'FACULTY or TA',
      role: 'STUDENT',
    });

    expect(text).toBe('student, needs faculty or ta');
  });

  it('describes an admin refusal', () => {
    expect(activityDetail('ADMIN_BACKUPS_VIEW_DENIED', { reason: 'not an administrator' })).toBe(
      'not an administrator',
    );
  });

  // Not every failure name ends in _ERROR or _DENIED.
  it('covers the failures whose names do not end in the usual way', () => {
    expect(activityDetail('SUBMISSION_UNAUTHORIZED', { reason: 'not signed in' })).toBe(
      'not signed in',
    );
    expect(activityDetail('GROUP_SET_MEMBERSHIP_CONFLICT', { reason: 'group set changed' })).toBe(
      'group set changed',
    );
  });
});

/** How somebody got in. Otherwise every sign-in row reads the same. */
describe('a sign-in', () => {
  it('tells an LMS launch apart from a password', () => {
    expect(objectPhrase('LOGIN_SUCCESS', { provider: 'lti-launch' })).toBe('LMS launch');
    expect(objectPhrase('LOGIN_SUCCESS', { provider: 'credentials' })).toBe('AFCT password');
    expect(objectPhrase('LOGIN_SUCCESS', { provider: 'oidc' })).toBe('Institutional sign-in');
  });

  it('says when a temporary password was used', () => {
    // The way in is the object ("AFCT password"); this half says what qualified it.
    const text = activityDetail('LOGIN_SUCCESS', {
      provider: 'credentials',
      temporaryPasswordLogin: true,
    });

    expect(text).toBe('temporary password');
    expect(
      describeActivity('LOGIN_SUCCESS', { provider: 'credentials', temporaryPasswordLogin: true }),
    ).toBe('AFCT password · temporary password');
  });

  // A provider added later should not read as though nothing happened.
  it('says nothing for a provider it does not know', () => {
    expect(activityDetail('LOGIN_SUCCESS', { provider: 'saml' })).toBeNull();
  });

  it('covers the native client the same way, and says it was the client', () => {
    expect(objectPhrase('CLIENT_LOGIN', { provider: 'credentials' })).toBe(
      'Desktop client, afct password',
    );
  });
});

/** A deep link is only interesting for which assignment it points at. */
describe('a deep link returned to the LMS', () => {
  it('names the assignment', () => {
    expect(activityDetail('LTI_DEEP_LINK_RETURNED', { assignmentTitle: 'LMS sync demo' })).toBe(
      'linked to LMS sync demo',
    );
  });

  it('says nothing when the title was not recorded', () => {
    expect(activityDetail('LTI_DEEP_LINK_RETURNED', { issuer: 'Client' })).toBeNull();
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
    expect(activityDetail('VIEW_STUDENT_SUBMISSION', { source: 'client' })).toBe(
      'one student, from the desktop client',
    );
    expect(activityDetail('VIEW_STUDENT_REVIEW_DATA', { source: 'review-data' })).toBe(
      'one student, from the review workspace',
    );
  });

  // The code's own label would leak into a sentence a person reads.
  it('falls back to the raw source rather than dropping it', () => {
    expect(activityDetail('VIEW_STUDENT_SUBMISSION', { source: 'something-new' })).toBe(
      'one student, from something-new',
    );
  });

  /**
   * No student is named. The row already points at them through `targetUserId`, and a name in a
   * column read over somebody's shoulder is its own small disclosure.
   */
  it('never names the student', () => {
    const summary = activityDetail('VIEW_STUDENT_SUBMISSION', {
      viewedStudentId: 'u-123',
      studentName: 'Ada Lovelace',
      source: 'web',
    });

    expect(summary).not.toContain('Ada');
    expect(summary).not.toContain('u-123');
  });

  // One student's work and a whole assignment's are different disclosures.
  it('tells one student apart from the whole assignment', () => {
    expect(activityDetail('VIEW_ASSIGNMENT_SUBMISSIONS', { viewedStudentId: 'u-1' })).toBe(
      "one student's submissions",
    );
    expect(activityDetail('VIEW_ASSIGNMENT_SUBMISSIONS', { assignmentId: 'a-1' })).toBe(
      'the whole assignment',
    );
  });

  it('counts an export', () => {
    expect(
      activityDetail('GRADES_EXPORTED', {
        studentCount: 34,
        assignmentCount: 6,
        platform: 'canvas',
      }),
    ).toBe('34 students, 6 assignments, for canvas');
  });

  it('says when an export was the whole gradebook', () => {
    expect(activityDetail('GRADES_EXPORTED', { studentCount: 34, wholeGradebook: true })).toBe(
      '34 students, whole gradebook',
    );
  });
});

describe('grades and attempts', () => {
  it('says what a group was given and how many it reached', () => {
    expect(
      activityDetail('GROUP_PROBLEM_GRADE_UPDATED', {
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
    const summary = activityDetail('GROUP_PROBLEM_GRADE_UPDATED', {
      groupName: 'Group A',
      grade: 8,
      memberIds: ['u1', 'u2'],
      overwroteDiffering: true,
    });

    expect(summary).toContain('replaced differing marks');
  });

  it('says which way an attempt grant went, and why', () => {
    expect(
      activityDetail('GRANT_EXTRA_SUBMISSIONS', {
        extraSubmissions: 2,
        totalExtraSubmissions: 5,
        targetType: 'STUDENT',
        reason: 'illness',
      }),
    ).toBe('+2 attempts for one student (5 in total): illness');

    expect(
      activityDetail('REVOKE_EXTRA_SUBMISSIONS', { extraSubmissions: 1, targetType: 'GROUP' }),
    ).toBe('-1 attempt for a group');
  });

  it('says how many submissions a bulk re-run touched', () => {
    expect(activityDetail('COURSE_SUBMISSIONS_RERUN', { count: 42 })).toBe('42 submissions re-run');
  });
});

describe('accounts and enrolment', () => {
  it('names the account a create or delete was about', () => {
    expect(activityDetail('CREATE_USER', { createdUserEmail: 'a@b.test' })).toBe('a@b.test');
    expect(activityDetail('DELETE_USER', { deletedUserEmail: 'gone@b.test' })).toBe('gone@b.test');
  });

  it('counts a bulk enrolment', () => {
    expect(activityDetail('BULK_ENROLL_USERS', { enrolledCount: 12, reEnrolledCount: 3 })).toBe(
      '12 enrolled, 3 re-enrolled',
    );
  });

  it('says plainly when a bulk enrolment did nothing', () => {
    expect(activityDetail('BULK_ENROLL_USERS', { enrolledCount: 0 })).toBe('nobody enrolled');
  });

  // The difference between a real reset request and a probe at an address with no account.
  it('says whether a reset link was actually sent', () => {
    expect(activityDetail('PASSWORD_RESET_REQUESTED', { queued: true })).toBe('a link was sent');
    expect(activityDetail('PASSWORD_RESET_REQUESTED', { queued: false })).toBe(
      'no account, nothing sent',
    );
  });

  it('says whether an unlocked account was locked in the first place', () => {
    expect(activityDetail('UNLOCK_ACCOUNT', { wasLocked: true })).toBe('was locked out');
    expect(activityDetail('UNLOCK_ACCOUNT', { wasLocked: false })).toBe('was not locked');
  });
});

describe('courses and their contents', () => {
  /** A deleted course takes its assignments, problems and enrolments with it. */
  it('says how much a course deletion destroyed, and which course it was', () => {
    const meta = {
      courseCode: 'CMPSC 464',
      courseName: 'Theory',
      assignmentCount: 8,
      problemCount: 40,
      studentCount: 31,
    };

    // The scale is this half's job; the course is the object's, from the names the deletion
    // recorded on its way out. The relation cannot resolve a course that no longer exists.
    expect(activityDetail('DELETE_COURSE', meta)).toBe('8 assignments, 40 problems, 31 students');
    expect(describeActivity('DELETE_COURSE', meta)).toBe(
      'CMPSC 464, Theory · 8 assignments, 40 problems, 31 students',
    );
  });

  // Adding a problem to an assignment students have already worked on is worth flagging.
  it('flags problems added to an assignment that already has submissions', () => {
    const summary = activityDetail('ADD_ASSIGNMENT_PROBLEMS', {
      addedProblemIds: ['p1', 'p2'],
      linksWithSubmissions: 1,
    });

    expect(summary).toBe('2 problems added, 1 already has submissions');
  });

  it('says which way an assignment type changed', () => {
    expect(activityDetail('CHANGE_ASSIGNMENT_TYPE', { isGroup: true })).toBe(
      'to a group assignment',
    );
    expect(activityDetail('CHANGE_ASSIGNMENT_TYPE', { isGroup: false })).toBe(
      'to an individual assignment',
    );
  });

  it('says what a group was renamed from', () => {
    expect(
      activityDetail('UPDATE_GROUP_SET_GROUP', { previousName: 'Group A', name: 'Team A' }),
    ).toBe('Group A to Team A');
  });

  it('does not report a rename that kept the same name', () => {
    // "Group 2 to Group 2" was on the live log. Saving without changing the name is a real
    // request and stays recorded; it just is not a change.
    expect(
      activityDetail('UPDATE_GROUP_SET_GROUP', { previousName: 'Group 2', name: 'Group 2' }),
    ).toBeNull();
  });
});

describe('the system itself', () => {
  it('says which version an update was going to', () => {
    expect(activityDetail('SYSTEM_UPDATE_REQUESTED', { fromTag: 'v0.3.0', tag: 'v0.4.0' })).toBe(
      'v0.3.0 to v0.4.0',
    );
  });

  it('names the version once when a release is reinstalled over itself', () => {
    // Re-running the installed version is a normal way out of a bad deploy, and the log read
    // "v0.9.1 to v0.9.1", which looked like a move that never happened.
    expect(activityDetail('SYSTEM_UPDATE_REQUESTED', { fromTag: 'v0.9.1', tag: 'v0.9.1' })).toBe(
      'v0.9.1',
    );
    expect(activityDetail('SYSTEM_UPDATE_COMPLETED', { fromTag: 'v0.9.1', toTag: 'v0.9.1' })).toBe(
      'now on v0.9.1',
    );
  });

  it('marks a forced downgrade as forced', () => {
    expect(
      activityDetail('SYSTEM_DOWNGRADE_REQUESTED', {
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
    const summary = activityDetail('SYSTEM_SETTINGS_UPDATED', {
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
  it.each(['VIEW_USERS', 'VIEW_ASSIGNMENT_PROBLEMS', 'SYSTEM_BACKUP_REQUESTED'])(
    '%s says nothing, because there is nothing to add',
    (action) => {
      expect(activityDetail(action, { userId: 'u-1' })).toBeNull();
    },
  );

  it('says nothing for an action it has never heard of', () => {
    expect(activityDetail('SOME_FUTURE_ACTION', { anything: 'at all' })).toBeNull();
  });

  // A failure still reports why, matched on the name so a new one needs no case.
  it('still reports why a failure failed', () => {
    expect(activityDetail('COURSE_CREATE_ERROR', { error: 'duplicate code' })).toBe(
      'duplicate code',
    );
  });
});

describe('the entries an administrator reads after the fact', () => {
  it('says which versions a finished update moved between', () => {
    expect(activityDetail('SYSTEM_UPDATE_COMPLETED', { fromTag: 'v0.8.3', toTag: 'v0.8.4' })).toBe(
      'v0.8.3 to v0.8.4',
    );
  });

  it('reports the version a rollback ended on, not the one it was trying for', () => {
    expect(
      activityDetail('SYSTEM_UPDATE_ROLLED_BACK', { fromTag: 'v0.8.3', toTag: 'v0.8.4' }),
    ).toBe('v0.8.4 failed, back on v0.8.3');
  });

  it('still names the version when only one end of the move was recorded', () => {
    expect(activityDetail('SYSTEM_UPDATE_COMPLETED', { toTag: 'v0.8.4' })).toBe('now on v0.8.4');
    expect(activityDetail('SYSTEM_UPDATE_COMPLETED', { requestId: 'r-1' })).toBeNull();
  });

  it('says which kind of session a sign-out ended', () => {
    // Which session is the object now; the verb beside it already says it ended.
    expect(objectPhrase('LOGOUT', { provider: 'oidc' })).toBe('Institutional sign-in session');
    expect(objectPhrase('LOGOUT', { provider: 'credentials' })).toBe('Password session');
    expect(objectPhrase('CLIENT_LOGOUT', { provider: 'lti-launch' })).toBe(
      'Desktop client session',
    );
  });

  // Sessions started before the provider was carried on the token, which is most of what is
  // in the log on the machine this was written for.
  /*
   * A session started before the provider was carried on the token, which is most of what is
   * already in the log. The verb still says what happened; nothing is invented to fill the
   * object, because claiming a password session that may have been an LMS launch would be a
   * false audit statement.
   */
  it('still records a sign-out whose session never said where it came from', () => {
    expect(describeActivity('LOGOUT', { userId: 'u-1' })).toBeNull();
    expect(actionLabel('LOGOUT')).toBe('Signed out');
  });

  it('names the way in that an unlink took away', () => {
    expect(
      activityDetail('IDENTITY_UNLINKED', { kind: 'OIDC', issuer: 'https://idp.example.edu' }),
    ).toBe('OIDC at https://idp.example.edu removed');
  });

  it('still reports an unlink recorded before the issuer was kept', () => {
    expect(activityDetail('IDENTITY_UNLINKED', { targetUserId: 'u-1', identityId: 'li-1' })).toBe(
      'a way in was removed',
    );
  });
});

/**
 * The redesign's rule, tested as a rule rather than as a list of strings:
 *
 *     Action column   = the verb
 *     Subject column  = the object, then what happened to it
 *
 * The stored action never changes, so every case here reads a real stored value and asserts
 * only what is DISPLAYED from it.
 */
describe('the action column shows a verb', () => {
  it.each([
    ['COURSE_GRADES_VIEWED', 'Viewed'],
    ['VIEW_STUDENT_SUBMISSION', 'Viewed'],
    ['ASSIGNMENT_STATISTICS_VIEWED', 'Viewed'],
    ['CREATE_ASSIGNMENT', 'Created'],
    ['UPDATE_COURSE', 'Updated'],
    ['DELETE_PROBLEM', 'Deleted'],
    ['PROBLEM_GRADE_UPDATED', 'Graded'],
    ['SUBMISSION_AUTOGRADED', 'Graded'],
    ['SUBMISSION_CREATED', 'Submitted'],
    ['SUBMISSION_REJECTED_LATE', 'Rejected'],
    ['SUBMISSION_RATE_LIMITED', 'Rejected'],
    ['GRADES_EXPORTED', 'Exported'],
    ['COURSE_PUBLISHED', 'Published'],
    ['COURSE_UNARCHIVED', 'Restored'],
    ['LTI_ROSTER_SYNCED', 'Synced'],
    ['LOGIN_SUCCESS', 'Signed in'],
    ['LOGOUT', 'Signed out'],
    ['ROSTER_VIEW_DENIED', 'Denied'],
    ['ASSIGNMENT_UPDATE_ERROR', 'Failed'],
  ])('shows %s as %s', (action, verb) => {
    expect(actionLabel(action)).toBe(verb);
  });

  /*
   * Forward compatibility, and the one hard requirement in this file: an action added tomorrow
   * that nobody has mapped must still render as words. A blank Action column would make the
   * entry look like a bug in the table rather than a new kind of event.
   */
  it('never renders a future action blank', () => {
    expect(actionLabel('SOMETHING_NEW_HAPPENED')).toBe('Something new happened');
    expect(actionLabel('WIDGET_FROBNICATED')).toBe('Widget frobnicated');
  });
});

describe('what happened names the object', () => {
  const course = 'CMPSC 464, Theory of Computation';
  const full = { course, assignment: 'Homework 2', problem: 'DFA Problem' };

  it('names the gradebook, and copes when the course has gone', () => {
    expect(describeActivity('COURSE_GRADES_VIEWED', { studentCount: 17 }, { course })).toBe(
      `Course grades for ${course} · 17 students`,
    );
    // A historical row: no resolved relation, only the count it recorded at the time.
    expect(describeActivity('COURSE_GRADES_VIEWED', { studentCount: 17 })).toBe(
      'Course grades · 17 students',
    );
  });

  it('puts an assignment in its course, and a problem in its assignment', () => {
    expect(
      describeActivity(
        'UPDATE_ASSIGNMENT',
        { changes: { dueDate: { from: '2026-08-27', to: '2026-09-03' } } },
        { course, assignment: 'Homework 2' },
      ),
    ).toBe('Homework 2 in CMPSC 464 · Due date: 2026-08-27 to 2026-09-03');

    expect(describeActivity('PROBLEM_GRADE_UPDATED', { previousGrade: 8, grade: 10 }, full)).toBe(
      'DFA Problem in Homework 2 · 8 to 10',
    );
  });

  /*
   * The action outranks "the most specific relation present". An assignment update can carry a
   * problem relation, and reporting it as a problem update would name the wrong object in an
   * audit record.
   */
  it('lets the action decide which record it is about', () => {
    expect(describeActivity('UPDATE_ASSIGNMENT', {}, full)).toBe('Homework 2 in CMPSC 464');
    expect(describeActivity('UPDATE_PROBLEM', { fileUpdated: true }, full)).toBe(
      'DFA Problem in Homework 2 · solution file replaced',
    );
  });

  it('describes the submission pipeline by what it did to which problem', () => {
    expect(
      describeActivity(
        'SUBMISSION_CREATED',
        { originalFileName: 'submission.jff', status: 'PENDING' },
        full,
      ),
    ).toBe('DFA Problem in Homework 2 · submission.jff, pending');

    expect(
      describeActivity('SUBMISSION_AUTOGRADED', { grade: 10, maxPoints: 10, correct: true }, full),
    ).toBe('DFA Problem in Homework 2 · 10/10, correct');

    expect(describeActivity('SUBMISSION_REJECTED_LATE', {}, full)).toBe(
      'DFA Problem in Homework 2 · late submissions are not allowed',
    );
    expect(describeActivity('SUBMISSION_RATE_LIMITED', {}, full)).toBe(
      'DFA Problem in Homework 2 · resubmitted too quickly',
    );
    expect(
      describeActivity('SUBMISSION_FILE_TOO_LARGE', { originalFileName: 'big.jff' }, full),
    ).toBe('DFA Problem in Homework 2 · big.jff, over the upload limit');
  });

  /*
   * FERPA: a staff member reading a student's work is a disclosure, and the record has to say
   * WHAT was read. The student stays "one student" in this column, as before, because the
   * entry identifies them properly in its own fields; the object is what changes.
   */
  it('says what student work was read without naming the student here', () => {
    const summary = describeActivity('VIEW_STUDENT_SUBMISSION', { studentId: 'u-9' }, full);

    expect(summary).toContain('DFA Problem in Homework 2');
    expect(summary).toContain('one student');
    expect(summary).not.toContain('u-9');
  });

  it('names the course an export or a roster sync was for', () => {
    expect(describeActivity('LTI_ROSTER_SYNCED', { added: 6, dropped: 3 }, { course })).toBe(
      'Roster for CMPSC 464 · 6 added, 3 dropped',
    );
  });

  it('keeps a bare course event on the course', () => {
    expect(
      describeActivity('COURSE_PUBLISHED', {
        courseCode: 'CMPSC 464',
        courseName: 'Theory of Computation',
      }),
    ).toBe(course);
    expect(describeActivity('COURSE_ARCHIVED', {}, { course })).toBe(course);
    expect(describeActivity('COURSE_UNARCHIVED', {}, { course })).toBe(course);
  });

  it('falls back through relation, then metadata, then identifier', () => {
    // Relation resolved.
    expect(describeActivity('DELETE_ASSIGNMENT', {}, { assignment: 'Homework 2' })).toBe(
      'Homework 2',
    );
    // Deleted since, but the deletion recorded the title.
    expect(describeActivity('DELETE_ASSIGNMENT', { title: 'Homework 2' })).toBe('Homework 2');
    // Neither. The id is a poor name and still better than nothing.
    expect(describeActivity('DELETE_ASSIGNMENT', { assignmentId: 'abc123' })).toBe('abc123');
    // Nothing at all: no invention.
    expect(describeActivity('DELETE_ASSIGNMENT', {})).toBeNull();
  });

  it('says a system event is about the system', () => {
    expect(describeActivity('SYSTEM_BACKUP_REQUESTED', {})).toBe('System backup');
    expect(describeActivity('VIEW_USERS', {})).toBe('User list');
    expect(
      describeActivity('SYSTEM_UPDATE_COMPLETED', { fromTag: 'v0.9.0', toTag: 'v0.9.1' }),
    ).toBe('System update · v0.9.0 to v0.9.1');
  });

  /*
   * A denial or an error keeps the generic fallback that reports the reason, and now says what
   * it was refused ON where the entry knows.
   */
  it('keeps failures readable, with their object when there is one', () => {
    expect(
      describeActivity('COURSE_UPDATE_DENIED', { reason: 'not course staff' }, { course }),
    ).toBe('CMPSC 464, Theory of Computation · not course staff');
    expect(describeActivity('THING_ERROR', { error: 'connection lost' })).toBe('connection lost');
  });

  it('leaves an unmapped future action to its verb rather than inventing an object', () => {
    expect(describeActivity('WIDGET_FROBNICATED', {})).toBeNull();
    expect(actionLabel('WIDGET_FROBNICATED')).toBe('Widget frobnicated');
  });

  /*
   * Nothing in this column may carry a secret. The settings entry names the field that changed
   * and never its value, which is the rule the settings producer is written to.
   */
  it('never repeats a secret', () => {
    const summary = describeActivity('SYSTEM_SETTINGS_UPDATED', {
      changes: { smtpPassword: { from: '***', to: 'hunter2' } },
    });

    expect(summary ?? '').not.toContain('hunter2');
  });
});

/**
 * The actions added when the logging audit closed its gaps. Each exists because something a
 * person did was previously invisible, so the display test is really "does the row say what
 * happened".
 */
describe('the audit gaps that got their own entries', () => {
  it('says who watched the watchers, and what they narrowed it to', () => {
    expect(actionLabel('ADMIN_LOGS_VIEWED')).toBe('Viewed');
    expect(
      describeActivity('ADMIN_LOGS_VIEWED', { matched: 4210, aboutUserIds: ['u1'], search: 'ada' }),
    ).toBe('The activity log · narrowed to 1 account, search "ada", 4210 matching');
  });

  it('treats an export as its own event, with what was taken', () => {
    expect(actionLabel('ADMIN_LOGS_EXPORTED')).toBe('Exported');
    expect(
      describeActivity('ADMIN_LOGS_EXPORTED', {
        rows: 5000,
        fields: ['id', 'action'],
        truncated: true,
      }),
    ).toBe('The activity log · 5000 entries, 2 fields, truncated at the export limit');
  });

  it('names the course whose roster was read, and how many people that is', () => {
    expect(
      describeActivity('COURSE_ROSTER_VIEWED', { rosterSize: 31 }, { course: 'CMPSC 464, Theory' }),
    ).toBe('Roster for CMPSC 464, Theory · 31 people');
  });

  it('makes a privilege change legible as one', () => {
    expect(actionLabel('USER_ADMIN_GRANTED')).toBe('Granted');
    expect(actionLabel('USER_ADMIN_REVOKED')).toBe('Revoked');
    expect(describeActivity('USER_ADMIN_GRANTED', { userEmail: 'jsmith@psu.edu' })).toBe(
      'Account for jsmith@psu.edu',
    );
  });

  it('says which group a student came out of as well as the one they went into', () => {
    expect(
      describeActivity('GROUP_MEMBERSHIP_ASSIGNED', {
        fromGroupId: 'cmtf35e5j002p3sphlrtdb8js',
        toGroupId: 'cmtf35e5i002o3sphm1dbs8po',
        fromGroupName: 'Group A',
        toGroupName: 'Team B',
      }),
    ).toBe('one student, Group A to Team B');
  });

  it('does not put a group id on the line when the names were never recorded', () => {
    // What the log did before the names were kept. The fixture used to put "Group A" in an id
    // field, which is why nothing here noticed that the real entries read as cuids.
    expect(
      describeActivity('GROUP_MEMBERSHIP_ASSIGNED', {
        fromGroupId: 'cmtf35e5j002p3sphlrtdb8js',
        toGroupId: 'cmtf35e5i002o3sphm1dbs8po',
      }),
    ).toBe('one student');
  });

  it('reports the grade-sync switch as a change, not just an update', () => {
    expect(
      describeActivity(
        'ASSIGNMENT_GRADE_SYNC_UPDATED',
        { changes: { autoSync: { from: true, to: false } } },
        { assignment: 'Homework 2' },
      ),
    ).toBe('LMS grade sync for Homework 2 · Auto sync: true to false');
  });

  /*
   * Publishing keeps the stored action it always had. The verb is derived from which field
   * moved, so historical counts of UPDATE_ASSIGNMENT keep meaning one thing, and a save that
   * moved the due date as well is not mislabelled as a publish.
   */
  it('derives Published from a generic update without inventing a stored action', () => {
    const publishOnly = {
      changedFields: ['isPublished'],
      changes: { isPublished: { from: false, to: true } },
    };
    expect(actionLabel('UPDATE_ASSIGNMENT', publishOnly)).toBe('Published');
    expect(
      actionLabel('UPDATE_ASSIGNMENT', {
        ...publishOnly,
        changedFields: ['isPublished', 'dueDate'],
      }),
    ).toBe('Updated');
    expect(actionLabel('UPDATE_ASSIGNMENT')).toBe('Updated');
  });

  it('records a refused reach for another course grade sync', () => {
    expect(actionLabel('ASSIGNMENT_GRADE_SYNC_DENIED')).toBe('Denied');
    expect(
      describeActivity(
        'ASSIGNMENT_GRADE_SYNC_DENIED',
        { reason: 'does not manage this course' },
        { assignment: 'Homework 2' },
      ),
    ).toBe('Homework 2 · does not manage this course');
  });
});

describe('the address a reader sees', () => {
  it('names the sentinel the worker writes', () => {
    // No request made those entries: the submission worker and trial runner record `system`.
    // Capitalised so it reads as a word rather than as something somebody typed in.
    expect(displayIpAddress('system')).toBe('System');
  });

  it('names loopback', () => {
    expect(displayIpAddress('::1')).toBe('localhost');
    expect(displayIpAddress('127.0.0.1')).toBe('localhost');
  });

  it('drops the IPv4-mapped IPv6 prefix', () => {
    expect(displayIpAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
    // Only in front of an IPv4 address; a real IPv6 address keeps every part of itself.
    expect(displayIpAddress('::ffff:2001:db8::1')).toBe('::ffff:2001:db8::1');
  });

  it('passes an ordinary address through', () => {
    expect(displayIpAddress('203.0.113.7')).toBe('203.0.113.7');
  });

  it('says nothing when nothing was recorded', () => {
    expect(displayIpAddress(null)).toBeNull();
    expect(displayIpAddress('  ')).toBeNull();
    expect(displayIpAddress(undefined)).toBeNull();
  });
});

describe('the feedback switch in the log', () => {
  it('names it as what it is rather than as a column', () => {
    // The setting decides what a whole class sees, and RQ5 compares the two conditions, so the
    // audit line has to be readable a year later by somebody who did not build it.
    expect(
      describeActivity('UPDATE_ASSIGNMENT_PROBLEM_SETTINGS', {
        changes: { showFeedback: { from: true, to: false } },
      }),
    ).toContain('Feedback shown to students: true to false');
  });
});
