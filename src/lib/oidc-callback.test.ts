/**
 * Institutional sign-in, through Auth.js rather than around it.
 *
 * Every other test of this feature calls `resolveOidcSignIn` directly, which is the last step
 * and proves nothing about the steps before it. That is how AFCT shipped an OIDC provider that
 * could never work: an adapter was installed, Auth.js calls `getUserByAccount` on the callback
 * **before** the `signIn` callback runs, the adapter reads a Prisma `Account` model that this
 * schema has never had, and the sign-in died inside Auth.js with our resolver untouched.
 *
 * So this drives the real thing: a stub provider serves discovery, keys and a signed ID token;
 * Auth.js mints its own state and PKCE cookies on the way out and checks them on the way back;
 * and the Prisma stub throws if anything reaches for a model AFCT does not have.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const ISSUER = 'https://idp.example.test';
const CLIENT_ID = 'afct-client';
const AFCT_URL = 'https://afct.example.test';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

/**
 * Prisma, with only the models AFCT actually has.
 *
 * Reaching for anything else throws by name, which is what turns "the adapter is back" into a
 * failing test rather than a silent 500 in production.
 */
const store = vi.hoisted(() => ({
  user: { id: 'u-oidc', email: 'someone@school.edu', isAdmin: false, inactive: false },
}));

const prismaStub = vi.hoisted(() => ({
  linkedIdentity: {
    findUnique: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 'li-1' })),
  },
  user: {
    findUnique: vi.fn(async (_args: { where: Record<string, unknown> }) => null as unknown),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async () => ({ id: 'u-oidc' })),
    update: vi.fn(async () => ({ id: 'u-oidc' })),
  },
  activityLog: { create: vi.fn(async () => ({})) },
  systemSettings: { findUnique: vi.fn(async () => null) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaStub)),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(prismaStub as Record<string, unknown>, {
    get(target, property: string) {
      if (property in target) return target[property];
      // `account`, `session` and `verificationToken` are Auth.js's own tables. AFCT has none of
      // them, so anything asking for one is asking the wrong system for identity.
      throw new Error(`Prisma model "${property}" does not exist in AFCT's schema`);
    },
  }),
}));

vi.mock('@/lib/auth-secret', () => ({ requireAuthSecret: () => 'a-test-secret-value-32-chars-x' }));

// NextAuth's Next.js wrapper is not what is under test here: the config it would be given is
// handed straight to `@auth/core`, which is the part that runs the callback.
vi.mock('next-auth', () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock('next-auth/providers/credentials', () => ({
  default: (provider: Record<string, unknown>) => ({
    id: 'credentials',
    type: 'credentials',
    ...provider,
  }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/oidc-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oidc-provider')>();
  return {
    ...actual,
    getOidcConfig: async () => ({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: 'a-client-secret',
      buttonLabel: 'Sign in with Example',
      trustEmail: true,
    }),
  };
});

const { buildAuthConfig } = await import('./auth');
const { Auth } = await import('@auth/core');

/** What the authorization request asked for, which the ID token has to answer with. */
const asked = { nonce: null as string | null };

/** The stub provider: discovery, keys, and a token endpoint that signs what it is asked for. */
function identityProvider(claims: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.startsWith(`${ISSUER}/.well-known/openid-configuration`)) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    }

    if (url.startsWith(`${ISSUER}/jwks`)) return Response.json({ keys: [jwk] });

    if (url.startsWith(`${ISSUER}/token`)) {
      const idToken = await new SignJWT({
        ...claims,
        // Echoed from the authorization request, exactly as a real provider does. AFCT asks for
        // a nonce, and an ID token that does not carry it back is refused by Auth.js.
        ...(asked.nonce ? { nonce: asked.nonce } : {}),
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setSubject(String(claims.sub ?? 'idp-subject-1'))
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);

      return Response.json({ access_token: 'at', token_type: 'Bearer', id_token: idToken });
    }

    if (url.startsWith(`${ISSUER}/userinfo`)) return Response.json(claims);

    throw new Error(`the test provider was asked for ${url}`);
  });
}

const config = async () => ({
  ...(await buildAuthConfig()),
  secret: 'a-test-secret-value-32-chars-x',
  trustHost: true,
  basePath: '/api/auth',
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaStub.user.findUnique.mockResolvedValue(null);
  prismaStub.linkedIdentity.findUnique.mockResolvedValue(null);
});

afterEach(() => vi.unstubAllGlobals());

describe('an institutional sign-in, end to end through Auth.js', () => {
  /**
   * The whole round trip: Auth.js builds the authorization request and sets its own state and
   * PKCE cookies, then the callback is fed those cookies back.
   */
  const signInThrough = async (claims: Record<string, unknown>) => {
    vi.stubGlobal('fetch', identityProvider(claims));
    const authConfig = await config();

    // Out: the sign-in POST, which answers with a redirect to the provider plus its cookies.
    const csrf = await Auth(
      new Request(`${AFCT_URL}/api/auth/csrf`, { headers: { 'X-Test-Header': '1' } }),
      authConfig,
    );
    const csrfCookies = csrf.headers.getSetCookie().join('; ');
    const csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken;

    const started = await Auth(
      new Request(`${AFCT_URL}/api/auth/signin/oidc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: csrfCookies },
        body: new URLSearchParams({ csrfToken, callbackUrl: `${AFCT_URL}/dashboard` }),
      }),
      authConfig,
    );

    const location = started.headers.get('location') ?? '';
    const cookies = [csrfCookies, ...started.headers.getSetCookie()].join('; ');
    const authorizeUrl = new URL(location);
    const state = authorizeUrl.searchParams.get('state') ?? '';
    asked.nonce = authorizeUrl.searchParams.get('nonce');

    // Back: the provider redirects to the callback with a code, and Auth.js checks its cookies.
    return Auth(
      new Request(`${AFCT_URL}/api/auth/callback/oidc?code=the-code&state=${state}`, {
        headers: { cookie: cookies },
      }),
      authConfig,
    );
  };

  it('reaches AFCT rather than dying inside Auth.js on a table AFCT does not have', async () => {
    // A person AFCT already knows, by the durable issuer and subject.
    prismaStub.linkedIdentity.findUnique.mockResolvedValue({
      userId: store.user.id,
      user: store.user,
    } as never);

    const response = await signInThrough({
      sub: 'idp-subject-1',
      email: store.user.email,
      email_verified: true,
      given_name: 'Someone',
      family_name: 'Else',
    });

    // The identity was looked up the way AFCT means to look it up.
    expect(prismaStub.linkedIdentity.findUnique).toHaveBeenCalled();

    // And the answer is a session, not an error page. Auth.js redirects on success and puts
    // `?error=` on the URL when it refuses.
    const location = response.headers.get('location') ?? '';
    expect(location).not.toContain('error=');
    expect(response.headers.getSetCookie().join(' ')).toContain('session-token');
  });

  /**
   * Somebody whose institutional address changed.
   *
   * The identity is the issuer and the subject, so the account still resolves. The token used to
   * be filled in by looking the account up by the address the provider sent, which no longer
   * matches anything: the name vanished and `pwChangedAt` came back null against an account that
   * has a real `passwordChangedAt`, so the session was revoked the moment it was created.
   */
  it('still works when the provider now reports a different address', async () => {
    const changedAt = new Date('2026-01-01T00:00:00Z');
    prismaStub.linkedIdentity.findUnique.mockResolvedValue({
      userId: store.user.id,
      user: store.user,
    } as never);
    // Found by id; nothing in AFCT carries the new address.
    prismaStub.user.findUnique.mockImplementation(async (args) =>
      (args.where as { id?: string }).id === store.user.id
        ? { firstName: 'Someone', lastName: 'Else', passwordChangedAt: changedAt }
        : null,
    );

    const response = await signInThrough({
      sub: 'idp-subject-1',
      email: 'someone.new@school.edu',
      email_verified: true,
    });

    expect(response.headers.get('location') ?? '').not.toContain('error=');

    // Nothing looked the account up by the address the provider is asserting. That lookup is
    // the bug: it finds nothing once an institutional address changes, and the session that was
    // just minted is then treated as revoked.
    const lookedUpBy = prismaStub.user.findUnique.mock.calls.map((call) => call[0].where);
    expect(lookedUpBy).not.toContainEqual({ email: 'someone.new@school.edu' });
    expect(lookedUpBy).toContainEqual({ id: store.user.id });
  });
});
