import { describe, expect, it } from 'vitest';
import { buildOidcProvider } from './oidc-provider';

/**
 * The discovery address, which is not the issuer.
 *
 * Auth.js joins the two with a slash unconditionally, so an issuer that already ends in one
 * (Auth0 tenants publish exactly that) produced a double slash and a 404 that reads as "the
 * provider is misconfigured". The issuer itself must not be touched: it is compared against
 * `iss` exactly as the provider states it.
 */
describe('where discovery is looked for', () => {
  const built = (issuer: string) =>
    buildOidcProvider({
      issuer,
      clientId: 'client',
      clientSecret: 'secret',
      buttonLabel: null,
      trustEmail: false,
    });

  it('joins cleanly when the issuer ends in a slash', () => {
    const provider = built('https://tenant.eu.auth0.com/');

    expect(provider.wellKnown).toBe(
      'https://tenant.eu.auth0.com/.well-known/openid-configuration',
    );
    expect(provider.issuer).toBe('https://tenant.eu.auth0.com/');
  });

  it('joins cleanly when it does not', () => {
    const provider = built('https://login.example.edu/tenant/v2.0');

    expect(provider.wellKnown).toBe(
      'https://login.example.edu/tenant/v2.0/.well-known/openid-configuration',
    );
  });

  /** State, PKCE and the nonce: the last ties the ID token to this authorization request. */
  it('asks for a nonce as well as state and PKCE', () => {
    expect(built('https://login.example.edu').checks).toEqual(['pkce', 'state', 'nonce']);
  });
});
