import { describe, expect, it } from 'vitest';
import { OidcSettingsSchema } from './identity';

const issuer = OidcSettingsSchema.shape.oidcIssuer;
const accepts = (v: string) => issuer.safeParse(v).success;

/**
 * Everything about the provider is discovered from the issuer, so a wrong one produces symptoms
 * a long way from the cause. It is the only field on that tab worth validating properly.
 */
describe('the issuer URL', () => {
  it('accepts an ordinary provider URL', () => {
    expect(accepts('https://login.your-university.edu')).toBe(true);
  });

  it('accepts one with a path, which some providers use', () => {
    expect(accepts('https://login.microsoftonline.com/tenant-id/v2.0')).toBe(true);
  });

  it('accepts empty, meaning not configured', () => {
    expect(accepts('')).toBe(true);
  });

  // Discovery appends a well-known path, and a trailing slash produces a double slash that some
  // providers reject and others quietly 404. Better to refuse what was pasted.
  it('rejects a trailing slash', () => {
    expect(accepts('https://login.your-university.edu/')).toBe(false);
  });

  it('rejects plain http, which OIDC does not permit', () => {
    expect(accepts('http://login.your-university.edu')).toBe(false);
  });

  it('rejects something that is not a URL', () => {
    expect(accepts('login.your-university.edu')).toBe(false);
    expect(accepts('not a url')).toBe(false);
  });

  it('says what a valid issuer looks like when it rejects one', () => {
    const result = issuer.safeParse('nope');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/https:\/\/login\./);
    }
  });
});

describe('the defaults', () => {
  // Off unless an admin says otherwise: an install using only local accounts is unchanged, and
  // trusting a provider's email is a decision nobody should make by omission.
  it('leave sign-in and email trust alone when nothing is sent', () => {
    const parsed = OidcSettingsSchema.parse({});

    expect(parsed.oidcEnabled).toBeUndefined();
    expect(parsed.oidcTrustEmail).toBeUndefined();
  });
});
