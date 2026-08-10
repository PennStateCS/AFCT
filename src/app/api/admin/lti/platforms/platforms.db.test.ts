import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

/**
 * Registering an LMS, against a real Postgres.
 *
 * Registering one grants it the power to assert who somebody is, so the admin gate and the
 * duplicate guard are the parts worth proving.
 */

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; isAdmin: boolean; inactive?: boolean } } | null,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => session.current }));

const { GET, POST } = await import('./route');
const { DELETE } = await import('./[id]/route');

const ADMIN = 'u-ltiadmin';
const FACULTY = 'u-ltifaculty';
const ISSUER = 'https://canvas.example.test';

const valid = {
  name: 'Test Canvas',
  issuer: ISSUER,
  clientId: 'client-123',
  deploymentId: 'deploy-1',
  authLoginUrl: `${ISSUER}/api/lti/authorize_redirect`,
  tokenUrl: `${ISSUER}/login/oauth2/token`,
  keysetUrl: `${ISSUER}/api/lti/security/jwks`,
};

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://afct.example.test/api/admin/lti/platforms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    undefined,
  );

const del = (id: string) =>
  DELETE(
    new Request('https://afct.example.test/api/admin/lti/platforms/x', { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  );

async function destroyFixtures() {
  await prisma.ltiKeyPair.deleteMany({});
  await prisma.activityLog.deleteMany({ where: { userId: { in: [ADMIN, FACULTY] } } });
  await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN, FACULTY] } } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ADMIN, email: 'ltiadmin@example.test', password: 'x', isAdmin: true },
      { id: FACULTY, email: 'ltifaculty@example.test', password: 'x', isAdmin: false },
    ],
  });
  session.current = { user: { id: ADMIN, isAdmin: true } };
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('registering an LMS', () => {
  it('stores what the administrator pasted in', async () => {
    const res = await post(valid);

    expect(res.status).toBe(201);
    const row = await prisma.ltiPlatform.findFirstOrThrow({ where: { issuer: ISSUER } });
    expect(row).toMatchObject({ clientId: 'client-123', deploymentId: 'deploy-1' });
  });

  /**
   * The triple, not the issuer: one LMS can deploy AFCT more than once, and each deployment is
   * a separate registration.
   */
  it('allows a second deployment of the same LMS', async () => {
    await post(valid);

    const res = await post({ ...valid, deploymentId: 'deploy-2' });

    expect(res.status).toBe(201);
    expect(await prisma.ltiPlatform.count({ where: { issuer: ISSUER } })).toBe(2);
  });

  // The database constraint, not a check-then-create two administrators could both pass.
  it('refuses the same triple twice', async () => {
    await post(valid);

    const res = await post(valid);

    expect(res.status).toBe(409);
    expect(await prisma.ltiPlatform.count({ where: { issuer: ISSUER } })).toBe(1);
  });

  it('refuses a malformed URL, naming the field', async () => {
    const res = await post({ ...valid, keysetUrl: 'not-a-url' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('keysetUrl');
  });

  // Everything in LTI is signed and fetched over TLS; a plain-http endpoint is a setup error.
  it('refuses a plain http endpoint', async () => {
    const res = await post({ ...valid, tokenUrl: 'http://canvas.example.test/token' });

    expect(res.status).toBe(400);
  });

  /**
   * The LMS fetches AFCT's keyset while being set up. An empty one either fails there, or
   * fails much later when the first grade cannot be signed, which is far harder to trace.
   */
  it('makes sure AFCT has a keypair to publish', async () => {
    expect(await prisma.ltiKeyPair.count()).toBe(0);

    await post(valid);

    expect(await prisma.ltiKeyPair.count()).toBe(1);
  });

  it('does not mint a second key for a second LMS', async () => {
    await post(valid);
    await post({ ...valid, deploymentId: 'deploy-2' });

    expect(await prisma.ltiKeyPair.count()).toBe(1);
  });

  it('is recorded, because it grants an LMS the power to say who people are', async () => {
    await post(valid);

    const entry = await prisma.activityLog.findFirst({
      where: { action: 'LTI_PLATFORM_REGISTERED' },
    });
    expect(entry?.userId).toBe(ADMIN);
    expect(entry?.metadata).toMatchObject({ issuer: ISSUER, clientId: 'client-123' });
  });
});

describe('who may do this', () => {
  it('refuses a faculty member', async () => {
    session.current = { user: { id: FACULTY, isAdmin: false } };

    expect((await post(valid)).status).toBe(403);
    expect(await prisma.ltiPlatform.count({ where: { issuer: ISSUER } })).toBe(0);
  });

  it('refuses somebody signed out', async () => {
    session.current = null;

    expect((await post(valid)).status).toBe(401);
    expect((await GET(new Request('https://afct.example.test'), undefined)).status).toBe(401);
  });

  it('refuses a faculty member removing one', async () => {
    await post(valid);
    const row = await prisma.ltiPlatform.findFirstOrThrow({ where: { issuer: ISSUER } });
    session.current = { user: { id: FACULTY, isAdmin: false } };

    expect((await del(row.id)).status).toBe(403);
    expect(await prisma.ltiPlatform.count({ where: { issuer: ISSUER } })).toBe(1);
  });
});

describe('removing a registration', () => {
  it('stops that LMS launching', async () => {
    await post(valid);
    const row = await prisma.ltiPlatform.findFirstOrThrow({ where: { issuer: ISSUER } });

    expect((await del(row.id)).status).toBe(200);
    expect(await prisma.ltiPlatform.count({ where: { issuer: ISSUER } })).toBe(0);
  });

  it('is recorded with what it was', async () => {
    await post(valid);
    const row = await prisma.ltiPlatform.findFirstOrThrow({ where: { issuer: ISSUER } });
    await del(row.id);

    const entry = await prisma.activityLog.findFirst({
      where: { action: 'LTI_PLATFORM_REMOVED' },
    });
    expect(entry?.metadata).toMatchObject({ issuer: ISSUER, deploymentId: 'deploy-1' });
  });

  it('reports an id that is not there', async () => {
    expect((await del('does-not-exist')).status).toBe(404);
  });
});
