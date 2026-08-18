import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one decision in the NextAuth config that is not wiring: which cookies a sign-in gets.
 *
 * Both halves of it were already tested on their own. `lib/lti/frame-session` decides what a
 * framed launch needs and how a framed request is recognised; `proxy.ts` sets the marker. What
 * neither could prove is that they are connected: with the join missing, both suites stay green
 * and every launch inside an LMS still fails with `MissingCSRF`, which is the bug this exists to
 * stop coming back.
 *
 * Everything else here is mocked to the edge of the module, because the config is built on every
 * request and pulls in the adapter, the providers and the settings lookup on the way.
 */

const headersMock = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({ headers: headersMock }));

// NextAuth itself is never run: the factory is called directly, so nothing here starts a
// session or reaches a database.
vi.mock('next-auth', () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: () => ({}) }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth-secret', () => ({ requireAuthSecret: () => 'test-secret' }));
vi.mock('@/lib/oidc-provider', () => ({
  // No institutional sign-in configured, which is the default and keeps this to one variable.
  getOidcConfig: async () => null,
  buildOidcProvider: () => ({}),
  OIDC_PROVIDER_ID: 'oidc',
}));

const { buildAuthConfig } = await import('./auth');
const { LTI_FRAME_COOKIE } = await import('./lti/frame-session');

/** A request carrying whatever cookie header the test gives it. */
const requestWith = (cookie: string | null) =>
  headersMock.mockResolvedValue(new Headers(cookie ? { cookie } : {}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the cookies a sign-in gets', () => {
  it('leaves them alone for an ordinary request', async () => {
    requestWith('some-other=1');

    const config = await buildAuthConfig();

    // Nothing overridden, so Auth.js keeps its own SameSite=Lax defaults. Widening these for
    // everybody would put every ordinary session in reach of any site that can make a browser
    // issue a request, to solve a problem only framed launches have.
    expect(config.cookies).toBeUndefined();
  });

  it('widens and partitions them inside a framed launch', async () => {
    requestWith(`${LTI_FRAME_COOKIE}=1`);

    const config = await buildAuthConfig();

    expect(config.cookies?.sessionToken?.options).toMatchObject({
      sameSite: 'none',
      secure: true,
      partitioned: true,
    });
    // The CSRF cookie matters as much as the session one: the sign-in POST is checked against
    // it, and it is the cookie whose absence produced `MissingCSRF` on every framed launch.
    expect(config.cookies?.csrfToken?.options).toMatchObject({
      sameSite: 'none',
      partitioned: true,
    });
  });

  it('does not widen the OAuth cookies even then', async () => {
    // Institutional sign-in never runs inside an LMS frame, so loosening state, nonce or PKCE
    // would be a change nobody asked for.
    requestWith(`${LTI_FRAME_COOKIE}=1`);

    const config = await buildAuthConfig();

    expect(config.cookies?.state).toBeUndefined();
    expect(config.cookies?.nonce).toBeUndefined();
    expect(config.cookies?.pkceCodeVerifier).toBeUndefined();
  });

  it('treats a request it cannot read headers for as not framed', async () => {
    // A programmatic call outside a request: the safe answer is the strict cookies.
    headersMock.mockRejectedValue(new Error('called outside a request'));

    const config = await buildAuthConfig();

    expect(config.cookies).toBeUndefined();
  });

  it('is not fooled by a cookie whose name merely ends with the marker', async () => {
    requestWith(`not-${LTI_FRAME_COOKIE}=1`);

    expect((await buildAuthConfig()).cookies).toBeUndefined();
  });
});
