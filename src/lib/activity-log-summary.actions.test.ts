/**
 * Every action the log presentation special-cases, one row each.
 *
 * The sibling file tests behaviour by story ("a roster sync says what changed"). This one is a
 * sweep: each entry in the object table and each arm of the detail switch, with and without the
 * metadata it hopes for. Both halves matter, because the fallback arm is what a reader sees on
 * an entry written before the field existed, and a blank or half-built phrase there is exactly
 * the kind of thing nobody notices until an auditor asks what a row meant.
 */

import { describe, expect, it } from 'vitest';
import { activityDetail, objectPhrase, type RelatedRecords } from './activity-log-summary';

type Meta = Record<string, unknown>;

const COURSE = 'CMPSC 464, Theory of Computation';
const inCourse: RelatedRecords = { course: COURSE };
const work: RelatedRecords = { course: COURSE, assignment: 'Homework 2', problem: 'Problem 3' };
const EMAIL = 'ada@example.com';

/**
 * `[action, metadata, related, expected]`. `related` is null on the rows where the phrase comes
 * out of metadata alone, which is the only source a deleted record leaves behind.
 */
const NAMED: Array<[string, Meta, RelatedRecords | null, string]> = [
  ['COURSE_GRADES_VIEWED', {}, inCourse, `Course grades for ${COURSE}`],
  ['GRADES_EXPORTED', {}, inCourse, 'Grades for CMPSC 464'],
  ['VIEW_ASSIGNMENT_SUBMISSIONS', {}, work, 'Submissions for Homework 2 in CMPSC 464'],
  ['VIEW_STUDENT_PROBLEM_GRADES', {}, work, 'Problem grades for Homework 2'],
  ['VIEW_ASSIGNMENT_PROBLEMS', {}, work, 'Problems in Homework 2'],
  ['ASSIGNMENT_STATISTICS_VIEWED', {}, work, 'Statistics for Homework 2 in CMPSC 464'],
  ['ASSIGNMENT_SIMILARITY_VIEWED', {}, work, 'Similarity report for Homework 2 in CMPSC 464'],
  ['VIEW_USERS', { accounts: 12 }, null, 'User list, 12 accounts'],
  ['VIEW_USERS', { accounts: 1 }, null, 'User list, 1 account'],
  ['ADMIN_LOGS_VIEWED', {}, null, 'The activity log'],
  ['ADMIN_LOGS_EXPORTED', {}, null, 'The activity log'],
  ['ADMIN_STATUS_VIEWED', {}, null, 'System status'],
  ['ADMIN_SUBMISSIONS_VIEWED', {}, null, 'Every course’s submissions'],
  ['SYSTEM_SETTINGS_VIEWED', {}, null, 'System settings'],
  ['COURSE_ROSTER_VIEWED', {}, inCourse, `Roster for ${COURSE}`],
  ['USER_ADMIN_GRANTED', { userEmail: EMAIL }, null, `Account for ${EMAIL}`],
  ['USER_ADMIN_REVOKED', { userEmail: EMAIL }, null, `Account for ${EMAIL}`],
  ['ASSIGNMENT_GRADE_SYNC_UPDATED', {}, work, 'LMS grade sync for Homework 2'],
  ['LTI_GRADES_PUSH_REQUESTED', {}, work, 'Grades for Homework 2 to the LMS'],
  ['LTI_ROSTER_SYNCED', {}, inCourse, 'Roster for CMPSC 464'],
  ['PROBLEM_GRADE_CLEARED', {}, work, 'Grade for Problem 3 in Homework 2'],
  ['CREATE_COMMENT', {}, work, 'Feedback on Problem 3 in Homework 2'],
  ['DELETE_COMMENT', {}, work, 'Feedback on Problem 3 in Homework 2'],
  ['CHANGE_COURSE_ROLE', {}, inCourse, 'Course role in CMPSC 464'],
  ['UPDATE_ASSIGNMENT_AUDIENCE', {}, work, 'Homework 2 audience'],
  ['UPDATE_ASSIGNMENT_PROBLEM_SETTINGS', {}, work, 'Problem 3 in Homework 2 settings'],
  ['CREATE_ASSIGNMENT_OVERRIDE', {}, work, 'Homework 2 due-date override'],
  ['UPDATE_ASSIGNMENT_OVERRIDE', {}, work, 'Homework 2 due-date override'],
  ['DELETE_ASSIGNMENT_OVERRIDE', {}, work, 'Homework 2 due-date override'],
  ['LOGIN_SUCCESS', { provider: 'credentials' }, null, 'AFCT password'],
  ['LOGIN_SUCCESS', { provider: 'lti-launch' }, null, 'LMS launch'],
  ['LOGIN_SUCCESS', { provider: 'oidc' }, null, 'Institutional sign-in'],
  ['CLIENT_LOGIN', { provider: 'credentials' }, null, 'Desktop client, afct password'],
  ['LOGOUT', { provider: 'credentials' }, null, 'Password session'],
  ['LOGOUT', { provider: 'lti-launch' }, null, 'Session that came from an LMS'],
  ['LOGOUT', { provider: 'oidc' }, null, 'Institutional sign-in session'],
  ['CLIENT_LOGOUT', {}, null, 'Desktop client session'],
  ['CREATE_USER', { userEmail: EMAIL }, null, `Account for ${EMAIL}`],
  ['UPDATE_USER', { email: EMAIL }, null, `Account for ${EMAIL}`],
  ['DELETE_USER', { targetEmail: EMAIL }, null, `Account for ${EMAIL}`],
  ['USER_SIGNUP', { userEmail: EMAIL }, null, `Account for ${EMAIL}`],
  ['RESET_PASSWORD', { userEmail: EMAIL }, null, `Password for ${EMAIL}`],
  ['CHANGE_PASSWORD', {}, null, 'Own password'],
  ['SET_PASSWORD', {}, null, 'First password for the account'],
  ['UNLOCK_ACCOUNT', { userEmail: EMAIL }, null, EMAIL],
  ['CLEAR_RATE_LIMIT', { ip: '203.0.113.5' }, null, 'Login rate limit for 203.0.113.5'],
  ['SYSTEM_SETTINGS_UPDATED', {}, null, 'System settings'],
  ['SYSTEM_UPDATE_REQUESTED', {}, null, 'System update'],
  ['SYSTEM_UPDATE_COMPLETED', {}, null, 'System update'],
  ['SYSTEM_UPDATE_ROLLED_BACK', {}, null, 'System update'],
  ['SYSTEM_UPDATE_FAILED', {}, null, 'System update'],
  ['SYSTEM_DOWNGRADE_REQUESTED', {}, null, 'System downgrade'],
  ['SYSTEM_BACKUP_REQUESTED', {}, null, 'System backup'],
  ['SYSTEM_BACKUP_DOWNLOADED', {}, null, 'System backup'],
  ['SYSTEM_RESTORE_POINT_DELETE_REQUESTED', {}, null, 'Restore point'],
  ['TEST_EMAIL_SENT', {}, null, 'Test email'],
  ['TLS_CERT_RESET', {}, null, 'TLS certificate'],
  ['ABANDONED_FILE_DELETED', {}, null, 'Abandoned file'],
  ['ABANDONED_FILES_PURGED', {}, null, 'Abandoned files'],
];

describe('the object column, action by action', () => {
  it.each(NAMED)('%s names what it was about', (action, metadata, related, expected) => {
    expect(objectPhrase(action, metadata, related)).toBe(expected);
  });

  /**
   * The same actions with nothing to go on. An entry from before a field was recorded, or one
   * whose course has since been deleted, still has to read as something.
   */
  const BARE: Array<[string, string | null]> = [
    ['COURSE_GRADES_VIEWED', 'Course grades'],
    ['GRADES_EXPORTED', 'Grades'],
    ['VIEW_ASSIGNMENT_SUBMISSIONS', 'Assignment submissions'],
    ['VIEW_STUDENT_PROBLEM_GRADES', 'Problem grades'],
    ['VIEW_ASSIGNMENT_PROBLEMS', 'Assignment problems'],
    ['ASSIGNMENT_STATISTICS_VIEWED', 'Assignment statistics'],
    ['ASSIGNMENT_SIMILARITY_VIEWED', 'Similarity report'],
    ['VIEW_USERS', 'User list'],
    ['COURSE_ROSTER_VIEWED', 'Course roster'],
    ['USER_ADMIN_GRANTED', 'Account'],
    ['USER_ADMIN_REVOKED', 'Account'],
    ['ASSIGNMENT_GRADE_SYNC_UPDATED', 'LMS grade sync'],
    ['LTI_GRADES_PUSH_REQUESTED', 'Grades to the LMS'],
    ['LTI_ROSTER_SYNCED', 'Roster'],
    ['PROBLEM_GRADE_CLEARED', 'Problem grade'],
    ['CREATE_COMMENT', 'Feedback'],
    ['DELETE_COMMENT', 'Feedback'],
    ['CHANGE_COURSE_ROLE', 'Course role'],
    ['UPDATE_ASSIGNMENT_AUDIENCE', 'Assignment audience'],
    ['UPDATE_ASSIGNMENT_PROBLEM_SETTINGS', 'Assignment problem settings'],
    ['CREATE_ASSIGNMENT_OVERRIDE', 'Assignment due-date override'],
    ['UPDATE_ASSIGNMENT_OVERRIDE', 'Assignment due-date override'],
    ['DELETE_ASSIGNMENT_OVERRIDE', 'Assignment due-date override'],
    ['CLIENT_LOGIN', 'Desktop client'],
    ['CREATE_USER', 'Account'],
    ['UPDATE_USER', 'Account'],
    ['DELETE_USER', 'Account'],
    ['USER_SIGNUP', 'Account'],
    ['RESET_PASSWORD', 'Password'],
    ['UNLOCK_ACCOUNT', 'Account'],
    ['CLEAR_RATE_LIMIT', 'Login rate limit'],
    // Deliberately blank: claiming a password sign-in that may have been an LMS launch would
    // be a false statement about how somebody got in.
    ['LOGIN_SUCCESS', null],
    ['LOGOUT', null],
  ];

  it.each(BARE)('%s still reads sensibly with no metadata', (action, expected) => {
    expect(objectPhrase(action, {}, null)).toBe(expected);
  });

  it('never leaks a raw value into a phrase', () => {
    for (const [action] of NAMED) {
      const phrase = objectPhrase(action, {}, null);
      if (phrase === null) continue;
      expect(phrase).not.toMatch(/undefined|null|\[object/);
      expect(phrase.trim()).not.toBe('');
    }
  });
});

/** `[action, metadata, expected]` for the detail column, which is metadata only. */
const DETAIL: Array<[string, Meta, string | null]> = [
  // Updates that record what moved.
  [
    'UPDATE_ASSIGNMENT_OVERRIDE',
    { changes: { dueDate: { from: 'Aug 27', to: 'Sep 3' } } },
    'Due date: Aug 27 to Sep 3',
  ],
  [
    'UPDATE_GROUP_SET',
    { changes: { name: { from: 'Labs', to: 'Lab groups' } } },
    'Name: Labs to Lab groups',
  ],
  [
    'UPDATE_ASSIGNMENT_PROBLEM_SETTINGS',
    { changes: { points: { from: 5, to: 10 } } },
    'Points: 5 to 10',
  ],
  ['UPDATE_ASSIGNMENT_OVERRIDE', {}, null],

  // Enrolment.
  ['DROP_FROM_COURSE', { via: 'LTI_ROSTER_SYNC' }, 'from an LMS roster sync'],
  ['REENROLL_IN_COURSE', { via: 'LTI_ROSTER_SYNC' }, 'from an LMS roster sync'],
  ['DROP_FROM_COURSE', { changes: { role: { from: 'STUDENT', to: 'TA' } } }, 'Role: STUDENT to TA'],
  ['ENROLL_USER', { via: 'LTI_ROSTER_SYNC' }, 'from an LMS roster sync'],
  ['ENROLL_USER', {}, null],
  ['BULK_ENROLL_USERS', { enrolledCount: 3, reEnrolledCount: 1 }, '3 enrolled, 1 re-enrolled'],
  ['BULK_ENROLL_USERS', {}, 'nobody enrolled'],
  ['REMOVE_FROM_COURSE', { count: 4 }, '4 people removed'],
  ['REMOVE_FROM_COURSE', { count: 1 }, null],
  ['COURSE_JOINED', { courseCode: 'CMPSC 464', role: 'STUDENT' }, 'CMPSC 464, as student'],
  ['COURSE_JOINED', {}, null],
  ['LTI_ROSTER_SYNCED', { added: 6, dropped: 3 }, '6 added, 3 dropped'],

  // Group sets and memberships.
  [
    'UPDATE_GROUP_SET_MEMBERSHIPS',
    { assignedCount: 2, removedCount: 1 },
    '2 moved into a group, 1 taken out',
  ],
  ['UPDATE_GROUP_SET_MEMBERSHIPS', {}, 'nothing changed'],
  ['CREATE_GROUP_SET', { name: 'Labs', initialGroupCount: 4 }, 'Labs, 4 groups'],
  ['CREATE_GROUP_SET', {}, null],
  ['DELETE_GROUP_SET', { deletedName: 'Labs' }, null],
  ['UPDATE_GROUP_SET_GROUP', { previousName: 'Group A', name: 'Group 1' }, 'Group A to Group 1'],
  ['UPDATE_GROUP_SET_GROUP', { name: 'Group 1' }, 'Group 1'],
  ['UPDATE_GROUP_SET_GROUP', {}, null],
  [
    'DUPLICATE_GROUP_SET',
    { name: 'Labs (copy)', copiedMemberCount: 12 },
    'Labs (copy), 12 memberships copied',
  ],
  ['DUPLICATE_GROUP_SET', {}, null],
  [
    'GROUP_MEMBERSHIP_ASSIGNED',
    { fromGroupId: 'Group A', toGroupId: 'Group B' },
    'one student, Group A to Group B',
  ],
  ['GROUP_MEMBERSHIP_ASSIGNED', { toGroupId: 'Group B' }, 'one student, into Group B'],
  ['GROUP_MEMBERSHIP_REMOVED', { fromGroupId: 'Group A' }, 'one student, out of Group A'],
  ['GROUP_MEMBERSHIP_REMOVED', {}, 'one student'],

  // Audience and roles.
  ['UPDATE_ASSIGNMENT_AUDIENCE', { assignedToEveryone: true }, 'assigned to everyone'],
  [
    'UPDATE_ASSIGNMENT_AUDIENCE',
    { assigneeCount: 1, assigneeKind: 'group' },
    'assigned to 1 group',
  ],
  ['UPDATE_ASSIGNMENT_AUDIENCE', { assigneeCount: 5 }, 'assigned to 5 students'],
  ['CHANGE_COURSE_ROLE', { previousRole: 'STUDENT', newRole: 'TA' }, 'STUDENT to TA'],
  ['CHANGE_COURSE_ROLE', { newRole: 'TA' }, null],

  // LTI.
  [
    'LTI_PLATFORM_REGISTERED',
    { issuer: 'https://canvas.example', clientId: '10000', via: 'dynamic-registration' },
    'https://canvas.example, client 10000, automatic',
  ],
  ['LTI_PLATFORM_REMOVED', { issuer: 'https://canvas.example' }, 'https://canvas.example'],
  ['LTI_PLATFORM_REMOVED', {}, null],
  ['LTI_COURSE_LINKED', { contextId: 'ctx-1' }, 'LMS course ctx-1'],
  ['LTI_COURSE_UNLINKED', {}, null],
  [
    'LTI_LAUNCH_DENIED',
    { reason: 'unknown platform', observedClaims: { issuer: 'https://elsewhere' } },
    'unknown platform, claimed issuer https://elsewhere',
  ],
  ['LTI_LAUNCH_DENIED', { reason: 'unknown platform' }, 'unknown platform'],
  ['LTI_LAUNCH_DENIED', {}, null],
  [
    'LTI_DYNAMIC_REGISTRATION_FAILED',
    { reason: 'no registration endpoint' },
    'no registration endpoint',
  ],
  ['LTI_DEEP_LINK_RETURNED', { assignmentTitle: 'Homework 2' }, 'linked to Homework 2'],
  [
    'LTI_DEEP_LINK_REMOVED',
    { assignmentTitle: 'Homework 2', platform: 'Canvas' },
    'Homework 2 is no longer marked as in Canvas',
  ],
  [
    'LTI_DEEP_LINK_REMOVED',
    { assignmentTitle: 'Homework 2' },
    'Homework 2 is no longer marked as in an LMS',
  ],
  ['LTI_DEEP_LINK_REMOVED', {}, null],
  ['LTI_GRADES_PUSH_REQUESTED', { scope: 'student', queued: 1 }, 'one student, 1 grade queued'],
  ['LTI_GRADES_PUSH_REQUESTED', { queued: 0 }, 'nothing to send'],

  // Identities.
  [
    'IDENTITY_LINKED',
    { kind: 'oidc', via: 'JUST_IN_TIME', accountCreated: true },
    'oidc, created on first sign-in, new account',
  ],
  ['IDENTITY_LINKED', {}, null],
  ['IDENTITY_LINK_DENIED', { reason: 'email already in use' }, 'email already in use'],
  [
    'USER_IDENTITY_REASSIGNED',
    { fromUserEmail: 'old@example.com', targetUserEmail: EMAIL },
    `LMS sign-in moved from old@example.com to ${EMAIL}`,
  ],
  ['USER_IDENTITY_REASSIGNED', {}, 'an LMS sign-in was moved to another account'],
  ['IDENTITY_UNLINKED', { kind: 'oidc', issuer: 'https://idp' }, 'oidc at https://idp removed'],
  ['IDENTITY_UNLINKED', {}, 'a way in was removed'],

  // Sign-in and sign-out. The way in is the object, so only what qualifies it lands here.
  ['LOGIN_SUCCESS', { temporaryPasswordLogin: true }, 'temporary password'],
  ['LOGIN_SUCCESS', { provider: 'oidc' }, null],
  ['CLIENT_LOGIN', { temporaryPasswordLogin: true }, 'temporary password'],
  ['LOGOUT', { provider: 'credentials' }, null],
  ['CLIENT_LOGOUT', {}, null],

  // Reads of student work.
  ['VIEW_STUDENT_SUBMISSION', { source: 'client' }, 'one student, from the desktop client'],
  ['VIEW_STUDENT_REVIEW_DATA', { source: 'review-data' }, 'one student, from the review workspace'],
  ['VIEW_STUDENT_SUBMISSION', { source: 'somewhere-new' }, 'one student, from somewhere-new'],
  ['VIEW_STUDENT_SUBMISSION', {}, 'one student'],
  ['VIEW_ASSIGNMENT_SUBMISSIONS', { viewedStudentId: 'u1' }, "one student's submissions"],
  ['VIEW_ASSIGNMENT_SUBMISSIONS', {}, 'the whole assignment'],
  ['VIEW_STUDENT_PROBLEM_GRADES', { problemCount: 3 }, '3 problem grades, one student'],
  ['VIEW_STUDENT_PROBLEM_GRADES', {}, 'one student'],
  ['COURSE_GRADES_VIEWED', { studentCount: 17 }, '17 students'],
  ['COURSE_GRADES_VIEWED', {}, null],
  ['ASSIGNMENT_SIMILARITY_VIEWED', { matchGroups: 2 }, '2 match groups'],
  ['ASSIGNMENT_SIMILARITY_VIEWED', {}, null],
  ['ASSIGNMENT_STATISTICS_VIEWED', { participantCount: 21 }, '21 participants'],
  ['ASSIGNMENT_STATISTICS_VIEWED', {}, null],
  [
    'GRADES_EXPORTED',
    { studentCount: 17, wholeGradebook: true, platform: 'Canvas' },
    '17 students, whole gradebook, for Canvas',
  ],
  ['GRADES_EXPORTED', { assignmentCount: 4 }, '4 assignments'],
  ['GRADES_EXPORTED', {}, null],
  ['COURSE_ROSTER_VIEWED', { rosterSize: 1 }, '1 person'],
  ['COURSE_ROSTER_VIEWED', {}, null],
  [
    'ADMIN_LOGS_VIEWED',
    { aboutUserIds: ['u1', 'u2'], search: 'login', matched: 40 },
    'narrowed to 2 accounts, search "login", 40 matching',
  ],
  ['ADMIN_LOGS_VIEWED', {}, null],
  [
    'ADMIN_LOGS_EXPORTED',
    { rows: 1, fields: ['action', 'timestamp'], truncated: true },
    '1 entry, 2 fields, truncated at the export limit',
  ],
  ['ADMIN_LOGS_EXPORTED', {}, null],

  // Files.
  ['VIEW_PROBLEM_FILE', { originalFileName: 'dfa.jff' }, 'dfa.jff'],
  ['VIEW_SUBMISSION_FILE', { fileName: 'stored-uuid.jff' }, 'stored-uuid.jff'],
  ['DOWNLOAD_SUBMISSION_FILE', { file: 'dfa.jff' }, 'dfa.jff'],
  ['VIEW_SOLUTION_FILE', {}, null],
  ['DOWNLOAD_SOLUTION_FILE', { originalFileName: 'answer.jff' }, 'answer.jff'],
  ['SUBMISSION_FILE_RECEIVED', { originalFileName: 'dfa.jff' }, 'dfa.jff'],
  ['SUBMISSION_FILE_STORED', { fileName: 'stored-uuid.jff' }, 'stored-uuid.jff'],
  [
    'SUBMISSION_FILE_TOO_LARGE',
    { originalFileName: 'huge.jff' },
    'huge.jff, over the upload limit',
  ],
  ['SUBMISSION_FILE_TOO_LARGE', {}, 'over the upload limit'],

  // Grades and attempts.
  [
    'GROUP_PROBLEM_GRADE_UPDATED',
    { groupName: 'Group A', grade: 8, memberIds: ['a', 'b'], overwroteDiffering: true },
    'Group A, graded 8, 2 members, replaced differing marks',
  ],
  ['GROUP_PROBLEM_GRADE_UPDATED', {}, null],
  ['PROBLEM_GRADE_UPDATED', { previousGrade: 5, grade: 8 }, '5 to 8'],
  ['PROBLEM_GRADE_UPDATED', { grade: 8 }, 'graded 8'],
  ['PROBLEM_GRADE_UPDATED', {}, null],
  ['PROBLEM_GRADE_CLEARED', {}, 'grade removed'],
  [
    'GRANT_EXTRA_SUBMISSIONS',
    { extraSubmissions: 1, totalExtraSubmissions: 3, reason: 'illness' },
    '+1 attempt for one student (3 in total): illness',
  ],
  [
    'REVOKE_EXTRA_SUBMISSIONS',
    { extraSubmissions: 2, targetType: 'GROUP' },
    '-2 attempts for a group',
  ],
  ['SUBMISSION_RERUN', { status: 'COMPLETED' }, 're-run, now completed'],
  ['SUBMISSION_RERUN', {}, 're-run'],
  ['COURSE_SUBMISSIONS_RERUN', { count: 12 }, '12 submissions re-run'],
  ['COURSE_SUBMISSIONS_RERUN', {}, 'nothing to re-run'],
  ['SUBMISSION_CREATED', { originalFileName: 'dfa.jff', status: 'PENDING' }, 'dfa.jff, pending'],
  ['SUBMISSION_CREATED', {}, null],
  ['SUBMISSION_AUTOGRADED', { grade: 10, maxPoints: 10, correct: true }, '10/10, correct'],
  ['SUBMISSION_AUTOGRADED', { grade: 0, correct: false }, '0, incorrect'],
  ['SUBMISSION_AUTOGRADED', {}, null],
  [
    'SUBMISSION_AUTOGRADE_SKIPPED',
    { reason: 'grade held for manual review' },
    'grade held for manual review',
  ],
  ['SUBMISSION_STALE_DISCARDED', {}, 'the submission was reclaimed while it was being graded'],

  // Submissions the system turned down. Each says why, since that is the whole entry.
  ['SUBMISSION_LIMIT_REACHED', { limit: 3 }, 'submission limit reached (3)'],
  ['SUBMISSION_LIMIT_REACHED', {}, 'submission limit reached'],
  ['SUBMISSION_RATE_LIMITED', {}, 'resubmitted too quickly'],
  ['SUBMISSION_REJECTED_NOT_OPEN', {}, 'the assignment is not open yet'],
  ['SUBMISSION_REJECTED_LATE', {}, 'late submissions are not allowed'],
  ['SUBMISSION_REJECTED_LATE_CUTOFF', {}, 'the late cutoff has passed'],
  ['SUBMISSION_REJECTED_ARCHIVED', {}, 'the course is archived'],
  ['SUBMISSION_UNPUBLISHED_ASSIGNMENT', {}, 'the assignment is unpublished'],
  ['SUBMISSION_NOT_ASSIGNED', {}, 'this work is not assigned to that student'],
  ['SUBMISSION_FAILED_PERMANENTLY', {}, 'gave up after the maximum grading attempts'],
  ['PROBLEM_INVALID_FILE_STRUCTURE', { error: 'no automaton element' }, 'no automaton element'],

  // Accounts.
  ['CREATE_USER', { createdUserEmail: EMAIL }, EMAIL],
  ['DELETE_USER', { deletedUserEmail: EMAIL }, EMAIL],
  ['DELETE_USER', { deletedUserName: 'Ada Lovelace' }, 'Ada Lovelace'],
  [
    'UPDATE_USER',
    { changes: { firstName: { from: 'Ada', to: 'Augusta' } } },
    'First name: Ada to Augusta',
  ],
  ['UPDATE_USER', { avatarChanged: true }, 'profile photo'],
  ['UPDATE_USER', {}, null],
  ['BULK_CREATE_USERS', { createdCount: 10, failedCount: 2 }, '10 created, 2 failed'],
  ['BULK_CREATE_USERS', {}, 'nothing to create'],
  ['USER_SIGNUP', { normalizedEmail: EMAIL }, EMAIL],
  ['RESET_PASSWORD', { temporaryPassword: true }, 'temporary password set'],
  ['RESET_STUDENT_PASSWORD', {}, null],
  ['CHANGE_PASSWORD', { wasTemporaryPassword: true }, 'replaced a temporary password'],
  ['CHANGE_PASSWORD', {}, null],
  ['SET_PASSWORD', {}, 'first password, set by the account holder'],
  ['SET_PASSWORD_DENIED', {}, 'this site does not allow it'],
  [
    'PASSWORD_RESET_REQUESTED',
    { kind: 'explanation' },
    'no password to reset, told how to sign in',
  ],
  ['PASSWORD_RESET_REQUESTED', { queued: true }, 'a link was sent'],
  ['PASSWORD_RESET_REQUESTED', {}, 'no account, nothing sent'],
  ['UNLOCK_ACCOUNT', { wasLocked: true }, 'was locked out'],
  ['UNLOCK_ACCOUNT', {}, 'was not locked'],
  [
    'CLEAR_RATE_LIMIT',
    { scope: 'ip', targetIp: '203.0.113.5', attempts: 1 },
    'ip, 203.0.113.5, after 1 attempt',
  ],
  ['CLEAR_RATE_LIMIT', {}, null],
  [
    'PROFILE_UPDATED',
    { firstName: 'Ada', timezone: 'UTC', avatarUpdated: true },
    'name, time zone, photo',
  ],
  ['PROFILE_UPDATED', { avatarDeleted: true }, 'photo removed'],
  ['PROFILE_UPDATED', {}, null],
  ['CLIENT_TOKEN_ISSUED', { label: 'laptop' }, 'laptop'],
  ['CLIENT_TOKEN_REVOKED', {}, null],

  // Courses, assignments, problems.
  ['CREATE_COURSE', {}, null],
  [
    'DELETE_COURSE',
    { assignmentCount: 4, problemCount: 12, studentCount: 30 },
    '4 assignments, 12 problems, 30 students',
  ],
  ['DELETE_COURSE', {}, null],
  ['COURSE_DUPLICATED', { courseCode: 'CMPSC 464', copyMode: 'FULL' }, 'CMPSC 464, copied full'],
  ['COURSE_DUPLICATED', {}, null],
  ['CREATE_ASSIGNMENT', { assignedToEveryone: true }, 'assigned to everyone'],
  ['CREATE_ASSIGNMENT', { assigneeCount: 2 }, 'assigned to 2 students'],
  ['CREATE_ASSIGNMENT', {}, null],
  ['DELETE_ASSIGNMENT', { title: 'Homework 2' }, null],
  ['REMOVE_ASSIGNMENT_PROBLEM', {}, null],
  ['DELETE_PROBLEM', {}, null],
  ['CREATE_PROBLEM', {}, null],
  ['UPDATE_PROBLEM', { fileUpdated: true }, 'solution file replaced'],
  ['UPDATE_PROBLEM', {}, null],
  ['DUPLICATE_PROBLEM', {}, null],
  ['IMPORT_PROBLEM', {}, null],
  [
    'DUPLICATE_ASSIGNMENT',
    { title: 'Homework 2 (copy)', problemCount: 3 },
    'Homework 2 (copy), 3 problems',
  ],
  ['IMPORT_ASSIGNMENT', {}, null],
  [
    'ADD_ASSIGNMENT_PROBLEMS',
    { addedProblemIds: ['p1', 'p2'], linksWithSubmissions: 1 },
    '2 problems added, 1 already has submissions',
  ],
  ['ADD_ASSIGNMENT_PROBLEMS', {}, null],
  ['CHANGE_ASSIGNMENT_TYPE', { isGroup: true }, 'to a group assignment'],
  ['CHANGE_ASSIGNMENT_TYPE', {}, 'to an individual assignment'],
  [
    'CREATE_ASSIGNMENT_OVERRIDE',
    { targetType: 'GROUP', dueDate: 'Sep 3' },
    'for a group, due Sep 3',
  ],
  ['DELETE_ASSIGNMENT_OVERRIDE', { previousDueDate: 'Sep 3' }, 'due Sep 3'],
  ['DELETE_ASSIGNMENT_OVERRIDE', {}, null],
  ['CREATE_COMMENT', { aboutGroupId: 'g1' }, 'about a group'],
  ['DELETE_COMMENT', {}, 'about one student'],

  // The system itself.
  [
    'SYSTEM_SETTINGS_UPDATED',
    { changes: { siteName: { from: 'AFCT', to: 'AFCT dev' } } },
    'Site name: AFCT to AFCT dev',
  ],
  [
    'SYSTEM_SETTINGS_UPDATED',
    { smtpPasswordUpdated: true, hcaptchaSecretCleared: true },
    'mail password set, captcha secret cleared',
  ],
  ['SYSTEM_SETTINGS_UPDATED', {}, null],
  ['SYSTEM_UPDATE_REQUESTED', { fromTag: 'v0.9.0', tag: 'v0.9.1' }, 'v0.9.0 to v0.9.1'],
  ['SYSTEM_DOWNGRADE_REQUESTED', { tag: 'v0.9.0', forced: true }, 'v0.9.0, forced'],
  ['SYSTEM_UPDATE_REQUESTED', {}, null],
  ['SYSTEM_UPDATER_SELF_UPDATE_REQUESTED', { tag: 'v0.9.1' }, 'v0.9.1'],
  ['SYSTEM_UPDATE_COMPLETED', { fromTag: 'v0.9.0', toTag: 'v0.9.1' }, 'v0.9.0 to v0.9.1'],
  ['SYSTEM_UPDATE_COMPLETED', { toTag: 'v0.9.1' }, 'now on v0.9.1'],
  ['SYSTEM_UPDATE_COMPLETED', {}, null],
  [
    'SYSTEM_UPDATE_ROLLED_BACK',
    { fromTag: 'v0.9.0', toTag: 'v0.9.1' },
    'v0.9.1 failed, back on v0.9.0',
  ],
  ['SYSTEM_UPDATE_ROLLED_BACK', {}, 'put back as it was'],
  ['SYSTEM_RESTORE_POINT_DELETE_REQUESTED', { version: 'v0.9.0' }, 'v0.9.0'],
  [
    'SYSTEM_BACKUP_DOWNLOADED',
    { file: 'afct-2026-08-27.tar.gz.gpg' },
    'afct-2026-08-27.tar.gz.gpg',
  ],
  ['TEST_EMAIL_SENT', { recipient: EMAIL }, EMAIL],
  ['TLS_CERT_RESET', { revertedTo: 'self-signed' }, 'self-signed'],
  ['ABANDONED_FILE_DELETED', { fileName: 'orphan.jff' }, 'orphan.jff'],

  // The catch-all: anything whose name ends in a failure reports why, and nothing else does.
  ['SOME_FUTURE_ACTION_FAILED', { reason: 'ran out of disk' }, 'ran out of disk'],
  ['SOME_FUTURE_ACTION_FAILED', { error: 'ENOSPC' }, 'ENOSPC'],
  ['SOME_FUTURE_ACTION_FAILED', { message: 'no space left' }, 'no space left'],
  ['SOME_FUTURE_ACTION', { reason: 'ran out of disk' }, null],
];

describe('the what-happened column, action by action', () => {
  it.each(DETAIL)('%s with %j', (action, metadata, expected) => {
    expect(activityDetail(action, metadata)).toBe(expected);
  });

  it('says nothing at all when there is no metadata', () => {
    for (const [action] of DETAIL) {
      expect(() => activityDetail(action, null)).not.toThrow();
      expect(() => activityDetail(action, undefined)).not.toThrow();
    }
  });
});
