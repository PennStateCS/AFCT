import { describe, expect, it } from 'vitest';
import { oidcRefusalMessage } from './oidc-refusal-message';

/**
 * An institutional sign-in that is refused is not a wrong password, and saying so sent people
 * back to retype one that was never the problem. Each message names something the person or
 * their administrator can actually do.
 */
describe('what a refused institutional sign-in says', () => {
  it('explains a provider that shared no address', () => {
    expect(oidcRefusalMessage('no-email')).toMatch(/did not share an email address/);
  });

  it('explains a provider that did not confirm the address', () => {
    expect(oidcRefusalMessage('email-not-verified')).toMatch(/did not confirm/);
  });

  it('tells an administrator to connect their institution deliberately', () => {
    expect(oidcRefusalMessage('admin-requires-deliberate-link')).toMatch(/AFCT password/);
  });

  it('says an identity is attached elsewhere without naming the account', () => {
    const message = oidcRefusalMessage('already-linked-elsewhere');

    expect(message).toMatch(/already connected to a different AFCT account/);
    expect(message).not.toMatch(/@/);
  });

  /** An account that is closed is not told apart from one that never existed. */
  it('says nothing about whether an account exists', () => {
    expect(oidcRefusalMessage('account-inactive')).toBe(
      'That account is not available. Ask an administrator for help.',
    );
  });

  it('falls back to something honest for a reason it does not know', () => {
    expect(oidcRefusalMessage('something-new')).toMatch(/could not sign you in/);
    expect(oidcRefusalMessage(null)).toMatch(/could not sign you in/);
  });
});
