import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createKeyPair } from './keys';
import { ensureLineItem, postScore, findLtiUserId } from './ags';

/**
 * Sending grades to an LMS, against a real Postgres.
 *
 * A score that silently fails to arrive is the same class of failure as losing one, so the
 * cases worth proving are the refusals: each has to be named, not swallowed.
 */

const ISSUER = 'https://canvas.example.test';
const PLATFORM = { id: 'ltip-ags', clientId: 'client-1', tokenUrl: `${ISSUER}/token` };
const LINE_ITEMS_URL = `${ISSUER}/contexts/57135/line_items`;
const COURSE = 'c-ags';
const ASSIGNMENT = 'a-ags';
const USER = 'u-ags';
let contextLinkId = '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A platform that hands out a token and accepts whatever it is sent. */
function acceptingPlatform() {
  const calls: {
    url: string;
    body: unknown;
    headers: Record<string, string>;
    method: string;
  }[] = [];
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
    // A platform with no column for this assignment yet. Only writes are recorded.
    if (!init?.method || init.method === 'GET') return json([]);
    calls.push({ url, body: JSON.parse(String(init.body)), headers, method: init.method ?? 'GET' });
    return json({ id: `${LINE_ITEMS_URL}/42` });
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

async function destroyFixtures() {
  await prisma.ltiLineItem.deleteMany({});
  await prisma.ltiContextLink.deleteMany({ where: { platformId: PLATFORM.id } });
  await prisma.assignment.deleteMany({ where: { id: ASSIGNMENT } });
  await prisma.linkedIdentity.deleteMany({ where: { userId: USER } });
  await prisma.ltiPlatform.deleteMany({ where: { id: PLATFORM.id } });
  await prisma.course.deleteMany({ where: { id: COURSE } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.ltiKeyPair.deleteMany({});
}

beforeEach(async () => {
  await destroyFixtures();
  await createKeyPair();
  await prisma.user.create({ data: { id: USER, email: 'ags@example.test', password: null } });
  await prisma.course.create({
    data: {
      id: COURSE,
      name: 'Theory',
      code: 'CMPSC 464',
      semester: 'Fall 2026',
      credits: 3,
      startDate: new Date('2026-08-24T00:00:00Z'),
      endDate: new Date('2026-12-18T00:00:00Z'),
    },
  });
  await prisma.assignment.create({
    data: { id: ASSIGNMENT, courseId: COURSE, title: 'Problem set 1', dueDate: new Date() },
  });
  await prisma.ltiPlatform.create({
    data: {
      id: PLATFORM.id,
      name: 'Canvas',
      issuer: ISSUER,
      clientId: PLATFORM.clientId,
      deploymentId: '1',
      authLoginUrl: `${ISSUER}/auth`,
      tokenUrl: PLATFORM.tokenUrl,
      keysetUrl: `${ISSUER}/jwks`,
    },
  });
  const link = await prisma.ltiContextLink.create({
    data: {
      platformId: PLATFORM.id,
      contextId: 'ctx-1',
      courseId: COURSE,
      lineItemsUrl: LINE_ITEMS_URL,
    },
  });
  contextLinkId = link.id;
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

const ensure = () =>
  ensureLineItem({
    platform: PLATFORM,
    contextLinkId,
    lineItemsUrl: LINE_ITEMS_URL,
    assignmentId: ASSIGNMENT,
    label: 'Problem set 1',
    scoreMaximum: 100,
  });

describe('the gradebook column', () => {
  it('is created on the first grade and remembered', async () => {
    const calls = acceptingPlatform();

    const first = await ensure();
    const second = await ensure();

    expect(first).toEqual({ ok: true, value: `${LINE_ITEMS_URL}/42` });
    expect(second).toEqual(first);
    // Created once, not once per grade.
    expect(calls).toHaveLength(1);
  });

  it('carries the label and maximum the LMS will show', async () => {
    const calls = acceptingPlatform();

    await ensure();

    expect(calls[0]?.body).toMatchObject({ label: 'Problem set 1', scoreMaximum: 100 });
  });

  // Without it a second attempt makes another column rather than finding the platform's own.
  it('tags the column with the assignment it scores', async () => {
    const calls = acceptingPlatform();

    await ensure();

    expect(calls[0]?.body).toMatchObject({ resourceId: ASSIGNMENT });
  });

  /**
   * The reference implementation answers a line-item creation with an HTML page rather than
   * the JSON the spec asks for. Reading the id back is what makes that survivable, and it is
   * how the first real grade passback failed.
   */
  it('finds the column when the platform answers with something other than JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/token')) return json({ access_token: 'tok', expires_in: 3600 });
        if (init?.method === 'POST') return new Response('<html>created</html>', { status: 200 });
        return json([{ resourceid: ASSIGNMENT, id: `${LINE_ITEMS_URL}/55020` }]);
      }),
    );

    expect(await ensure()).toEqual({ ok: true, value: `${LINE_ITEMS_URL}/55020` });
  });

  /**
   * A duplicate column in somebody's gradebook is confusing and awkward to remove, and AFCT
   * forgetting its own record must not cause one.
   */
  it('adopts a column the platform already has instead of making another', async () => {
    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/token')) return json({ access_token: 'tok', expires_in: 3600 });
        if (init?.method === 'POST') {
          posts.push(url);
          return json({ id: `${LINE_ITEMS_URL}/new` });
        }
        return json([{ resourceid: ASSIGNMENT, id: `${LINE_ITEMS_URL}/existing` }]);
      }),
    );

    expect(await ensure()).toEqual({ ok: true, value: `${LINE_ITEMS_URL}/existing` });
    expect(posts).toHaveLength(0);
  });

  /**
   * A platform scales a score against the column's own maximum, so an assignment that grew
   * from 100 points to 150 would have every grade silently misreported until the column
   * catches up. The name matters far less, and is corrected at the same time.
   */
  it('corrects the column when the assignment is re-pointed', async () => {
    const calls = acceptingPlatform();
    await ensure();

    await ensureLineItem({
      platform: PLATFORM,
      contextLinkId,
      lineItemsUrl: LINE_ITEMS_URL,
      assignmentId: ASSIGNMENT,
      label: 'Problem set 1 (revised)',
      scoreMaximum: 150,
    });

    const update = calls.find((c) => c.method === 'PUT');
    expect(update?.body).toMatchObject({ scoreMaximum: 150, label: 'Problem set 1 (revised)' });
    const row = await prisma.ltiLineItem.findFirstOrThrow();
    expect(row.scoreMaximum).toBe(150);
  });

  it('leaves an unchanged column alone', async () => {
    const calls = acceptingPlatform();
    await ensure();
    await ensure();

    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('says so when the platform granted no grade scopes', async () => {
    acceptingPlatform();

    const result = await ensureLineItem({
      platform: PLATFORM,
      contextLinkId,
      lineItemsUrl: null,
      assignmentId: ASSIGNMENT,
      label: 'Problem set 1',
      scoreMaximum: 100,
    });

    expect(result).toEqual({ ok: false, reason: 'no-line-items-endpoint' });
  });
});

describe('sending a score', () => {
  it('posts to the column’s scores endpoint', async () => {
    const calls = acceptingPlatform();

    const result = await postScore({
      platform: PLATFORM,
      lineItemUrl: `${LINE_ITEMS_URL}/42`,
      ltiUserId: 'lms-user-1',
      scoreGiven: 88,
      scoreMaximum: 100,
    });

    expect(result).toEqual({ ok: true, value: null });
    expect(calls[0]?.url).toBe(`${LINE_ITEMS_URL}/42/scores`);
  });

  it('sends the score against the LMS’s own id for the person', async () => {
    const calls = acceptingPlatform();

    await postScore({
      platform: PLATFORM,
      lineItemUrl: `${LINE_ITEMS_URL}/42`,
      ltiUserId: 'lms-user-1',
      scoreGiven: 88,
      scoreMaximum: 100,
    });

    expect(calls[0]?.body).toMatchObject({
      userId: 'lms-user-1',
      scoreGiven: 88,
      scoreMaximum: 100,
      gradingProgress: 'FullyGraded',
    });
  });

  it('reports a refusal with what the platform said', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === PLATFORM.tokenUrl
          ? json({ access_token: 'tok', expires_in: 3600 })
          : new Response('line item not found', { status: 404 }),
      ),
    );

    const result = await postScore({
      platform: PLATFORM,
      lineItemUrl: `${LINE_ITEMS_URL}/42`,
      ltiUserId: 'lms-user-1',
      scoreGiven: 88,
      scoreMaximum: 100,
    });

    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    expect(result.ok === false && result.detail).toContain('not found');
  });

  it('separates an unreachable LMS from a refused grade', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        throw new Error('ECONNREFUSED');
      }),
    );

    const result = await postScore({
      platform: PLATFORM,
      lineItemUrl: `${LINE_ITEMS_URL}/42`,
      ltiUserId: 'lms-user-1',
      scoreGiven: 88,
      scoreMaximum: 100,
    });

    expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

/**
 * Until roster sync lands, AFCT only knows a student's LMS id if they have launched. That has
 * to be visible rather than quietly skipped, or faculty see fewer grades than they sent.
 */
describe('finding the LMS id for a person', () => {
  it('finds it once they have launched', async () => {
    await prisma.linkedIdentity.create({
      data: {
        userId: USER,
        kind: 'LTI',
        issuer: ISSUER,
        subject: 'lms-user-1',
        linkedVia: 'JUST_IN_TIME',
      },
    });

    expect(await findLtiUserId({ userId: USER, issuer: ISSUER })).toBe('lms-user-1');
  });

  it('is null for somebody who never has', async () => {
    expect(await findLtiUserId({ userId: USER, issuer: ISSUER })).toBeNull();
  });

  // An identity from institutional sign-in is not an LMS id, and posting it would be wrong.
  it('ignores an OIDC identity from the same institution', async () => {
    await prisma.linkedIdentity.create({
      data: {
        userId: USER,
        kind: 'OIDC',
        issuer: ISSUER,
        subject: 'sso-user-1',
        linkedVia: 'AUTO_VERIFIED_EMAIL',
      },
    });

    expect(await findLtiUserId({ userId: USER, issuer: ISSUER })).toBeNull();
  });
});
