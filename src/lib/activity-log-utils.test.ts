import { describe, it, expect } from 'vitest';
import { inferSeverity } from './activity-log-utils';

// Every action actually used in the app, mapped to its expected severity. Keeps
// the classifier honest against the real vocabulary.
const cases: Record<string, string[]> = {
  INFO: [
    'USER_SIGNUP',
    'CREATE_USER',
    'UPDATE_USER',
    'DELETE_USER',
    'VIEW_USERS',
    'RESET_PASSWORD',
    'CHANGE_PASSWORD',
    'LOGIN_SUCCESS',
    'SESSION_EXTENDED',
    'CREATE_COURSE',
    'UPDATE_COURSE',
    'DELETE_COURSE',
    'ENROLL_USER',
    'CHANGE_COURSE_ROLE',
    'CREATE_ASSIGNMENT',
    'DELETE_ASSIGNMENT',
    'CREATE_PROBLEM',
    'CREATE_COMMENT',
    'DOWNLOAD_SOLUTION_FILE',
    'TLS_CERT_INSTALLED',
    'TLS_CSR_GENERATED',
    'TLS_CERT_RESET',
    'SYSTEM_SETTINGS_UPDATED',
    'SUBMISSION_CREATED',
    'SUBMISSION_FILE_STORED',
    'SUBMISSION_EVALUATION_SUCCESS',
    'LOGIN_CHALLENGE_SOLVED',
    'SIGNUP_CHALLENGE_SOLVED',
  ],
  WARNING: [
    'SESSION_EXTENSION_FAILED',
    'SUBMISSION_INVALID_REQUEST',
    'SUBMISSION_INVALID_FILE_STRUCTURE',
    'SUBMISSION_RATE_LIMITED',
    'SUBMISSION_REJECTED_LATE',
    'SUBMISSION_REJECTED_LATE_CUTOFF',
    'SUBMISSION_FILE_TOO_LARGE',
    'SUBMISSION_EVALUATION_STDERR',
    'TLS_CERT_REJECTED',
  ],
  ERROR: [
    'SESSION_EXTENSION_ERROR',
    'LOGIN_ERROR',
    'TLS_CERT_ERROR',
    'SYSTEM_SETTINGS_UPDATE_ERROR',
    'SUBMISSION_ERROR',
    'SUBMISSION_EVALUATION_ERROR',
  ],
  SECURITY: [
    'LOGIN_FAILED',
    'LOGIN_RATE_LIMIT',
    'LOGIN_CHALLENGE_REQUIRED',
    'SIGNUP_RATE_LIMIT',
    'SIGNUP_CHALLENGE_REQUIRED',
    'SUBMISSION_UNAUTHORIZED',
    'SUBMISSION_FORBIDDEN',
    'TLS_UPDATE_DENIED',
    'SYSTEM_SETTINGS_UPDATE_DENIED',
  ],
};

describe('inferSeverity', () => {
  for (const [expected, actions] of Object.entries(cases)) {
    for (const action of actions) {
      it(`classifies ${action} as ${expected}`, () => {
        expect(inferSeverity(action)).toBe(expected);
      });
    }
  }

  it('defaults an unknown action to INFO', () => {
    expect(inferSeverity('SOMETHING_NEW')).toBe('INFO');
  });
});
