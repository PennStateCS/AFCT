import { describe, expect, it } from 'vitest';
import { canSetInitialPassword, describeHowToSignIn } from './account-credentials';

describe('canSetInitialPassword', () => {
  it('is true only with no password and the site allowing it', () => {
    expect(canSetInitialPassword({ hasPassword: false, allowed: true })).toBe(true);
  });

  /**
   * An account that already has a password is not "allowed to set" one. Changing it is the
   * other path and needs the current password, so answering true here would offer a form that
   * skips a check it must not skip.
   */
  it('is false when there is already a password, however the switch is set', () => {
    expect(canSetInitialPassword({ hasPassword: true, allowed: true })).toBe(false);
    expect(canSetInitialPassword({ hasPassword: true, allowed: false })).toBe(false);
  });

  it('is false when the site does not allow it', () => {
    expect(canSetInitialPassword({ hasPassword: false, allowed: false })).toBe(false);
  });
});

describe('describeHowToSignIn', () => {
  it('names the institution for an account that signs in there', () => {
    const lines = describeHowToSignIn(['OIDC']).join(' ');
    expect(lines).toMatch(/institution/i);
  });

  it('names the LMS for an account that only ever launches from one', () => {
    const lines = describeHowToSignIn(['LTI']).join(' ');
    expect(lines).toMatch(/LMS/);
  });

  it('names both when both are attached', () => {
    const lines = describeHowToSignIn(['OIDC', 'LTI']).join(' ');
    expect(lines).toMatch(/institution/i);
    expect(lines).toMatch(/LMS/);
  });

  /**
   * The case that matters most, and the one a matrix of the happy paths would miss: somebody
   * whose LMS access has ended cannot act on "open AFCT from your LMS", and after this change
   * they no longer get a reset link either. The administrator has to be named every time.
   */
  it('always names an administrator, whichever identities exist', () => {
    for (const kinds of [[], ['OIDC'], ['LTI'], ['OIDC', 'LTI']] as const) {
      expect(describeHowToSignIn([...kinds]).join(' ')).toMatch(/administrator/i);
    }
  });

  /**
   * A roster sync can create an account and then decline to attach the LMS identity, because it
   * already belongs to somebody else. Naming a way in that is not there would be worse than
   * saying only what is true.
   */
  it('claims no way in for an account that has none', () => {
    const lines = describeHowToSignIn([]).join(' ');
    expect(lines).not.toMatch(/institution/i);
    expect(lines).not.toMatch(/your LMS/);
    expect(lines).toMatch(/administrator/i);
  });
});
