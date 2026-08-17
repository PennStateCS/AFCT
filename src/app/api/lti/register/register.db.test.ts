import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashSingleUseToken } from '@/lib/single-use-token';
import { TOOL_CONFIGURATION_CLAIM } from '@/lib/lti/dynamic-registration';

/**
 * An LMS registering itself, against a real Postgres.
 *
 * The parts worth proving are the ones that decide whether a stranger can register an LMS, and
 * whether one link can register two: everything else in the flow is covered by the unit tests
 * next to the library. The platform is played by a stubbed `fetch`.
 */

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; isAdmin: boolean } } | null,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => session.current }));

const { POST } = await import('./route');
const { POST: MINT } = await import('@/app/api/admin/lti/registration-token/route');

const ADMIN = 'u-dynreg-admin';
const ISSUER = 'https://dynreg.example.test';
const CONFIG_URL = `${ISSUER}/.well-known/openid-configuration`;

const configuration = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`,
  registration_endpoint: `${ISSUER}/register`,
  'https://purl.imsglobal.org/spec/lti-platform-configuration': {
    product_family_code: 'canvas',
  },
};

/** A platform that answers both calls: its configuration, then the registration. */
function platformAnswering(registration: Record<string, unknown>, status = 201) {
  return vi.fn(async (url: string | URL) => {
    const target = String(url);
    if (target === CONFIG_URL) {
      return new Response(JSON.stringify(configuration), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(registration), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const register = (body: Record<string, unknown>) =>
  POST(
    new Request('https://afct.example.test/api/lti/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

/** Mint a link the way the admin tab does, and return the token out of it. */
async function mintToken(): Promise<string> {
  const res = await MINT(
    new Request('https://afct.example.test/api/admin/lti/registration-token', { method: 'POST' }),
    undefined,
  );
  const { url } = (await res.json()) as { url: string };
  return new URL(url).searchParams.get('rt') as string;
}

async function destroyFixtures() {
  await prisma.ltiKeyPair.deleteMany({});
  await prisma.activityLog.deleteMany({ where: { userId: ADMIN } });
  await prisma.singleUseToken.deleteMany({ where: { userId: ADMIN } });
  await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });
  await prisma.user.deleteMany({ where: { id: ADMIN } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.create({
    data: { id: ADMIN, email: 'dynreg-admin@example.test', password: 'x', isAdmin: true },
  });
  session.current = { user: { id: ADMIN, isAdmin: true } };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('the registration link', () => {
  it('is minted by an administrator, and only the hash is kept', async () => {
    const token = await mintToken();

    const rows = await prisma.singleUseToken.findMany({ where: { userId: ADMIN } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.purpose).toBe('LTI_DYNAMIC_REGISTRATION');
    expect(rows[0]?.tokenHash).toBe(hashSingleUseToken(token));
    // The plaintext exists in the link and nowhere else, like every other single-use token.
    expect(rows[0]?.tokenHash).not.toBe(token);
  });

  it('is refused to somebody who is not an administrator', async () => {
    session.current = { user: { id: ADMIN, isAdmin: false } };

    const res = await MINT(
      new Request('https://afct.example.test/api/admin/lti/registration-token', {
        method: 'POST',
      }),
      undefined,
    );

    expect(res.status).toBe(403);
    expect(await prisma.singleUseToken.count({ where: { userId: ADMIN } })).toBe(0);
  });
});

describe('registering', () => {
  it('saves the registration and records who is answerable for it', async () => {
    const token = await mintToken();
    vi.stubGlobal(
      'fetch',
      platformAnswering({
        client_id: 'client-77',
        [TOOL_CONFIGURATION_CLAIM]: { deployment_id: 'deploy-77' },
      }),
    );

    const res = await register({ token, openidConfiguration: CONFIG_URL });

    expect(res.status).toBe(201);
    const platform = await prisma.ltiPlatform.findFirst({ where: { issuer: ISSUER } });
    expect(platform).toMatchObject({
      clientId: 'client-77',
      deploymentId: 'deploy-77',
      tokenUrl: `${ISSUER}/token`,
      keysetUrl: `${ISSUER}/jwks`,
    });

    // The actor is the administrator who minted the link, not the LMS that redeemed it. That is
    // the whole reason the token carries a user.
    const log = await prisma.activityLog.findFirst({
      where: { action: 'LTI_PLATFORM_REGISTERED', userId: ADMIN },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as Record<string, unknown>).via).toBe('dynamic-registration');
  });

  it('makes no outbound request at all when the link is not good', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await register({ token: 'not-a-real-token', openidConfiguration: CONFIG_URL });

    expect(res.status).toBe(400);
    // This is the guard that stops an unauthenticated caller using this route to make AFCT's
    // server fetch an address of their choosing. Spending the token has to come first.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('spends the link, so one link cannot register two LMSs', async () => {
    const token = await mintToken();
    vi.stubGlobal(
      'fetch',
      platformAnswering({
        client_id: 'client-77',
        [TOOL_CONFIGURATION_CLAIM]: { deployment_id: 'deploy-77' },
      }),
    );

    expect((await register({ token, openidConfiguration: CONFIG_URL })).status).toBe(201);
    const second = await register({ token, openidConfiguration: CONFIG_URL });

    expect(second.status).toBe(400);
    expect(await prisma.ltiPlatform.count({ where: { issuer: ISSUER } })).toBe(1);
  });

  it('refuses an LMS that is already registered, without changing it', async () => {
    await prisma.ltiPlatform.create({
      data: {
        name: 'Already there',
        issuer: ISSUER,
        clientId: 'client-77',
        deploymentId: 'deploy-77',
        authLoginUrl: `${ISSUER}/auth`,
        tokenUrl: `${ISSUER}/token`,
        keysetUrl: `${ISSUER}/jwks`,
      },
    });
    const token = await mintToken();
    vi.stubGlobal(
      'fetch',
      platformAnswering({
        client_id: 'client-77',
        [TOOL_CONFIGURATION_CLAIM]: { deployment_id: 'deploy-77' },
      }),
    );

    const res = await register({ token, openidConfiguration: CONFIG_URL });

    expect(res.status).toBe(409);
    const platforms = await prisma.ltiPlatform.findMany({ where: { issuer: ISSUER } });
    expect(platforms).toHaveLength(1);
    expect(platforms[0]?.name).toBe('Already there');
  });

  it('logs why a failed registration failed, since nobody watching can see the exchange', async () => {
    const token = await mintToken();
    // A platform that registers AFCT and sends back no deployment id: legal, and unusable.
    vi.stubGlobal('fetch', platformAnswering({ client_id: 'client-77' }));

    const res = await register({ token, openidConfiguration: CONFIG_URL });

    expect(res.status).toBe(400);
    const log = await prisma.activityLog.findFirst({
      where: { action: 'LTI_DYNAMIC_REGISTRATION_FAILED', userId: ADMIN },
    });
    expect((log?.metadata as Record<string, unknown>).reason).toBe('no-deployment-id');
    expect(log?.severity).toBe('ERROR');
  });
});
