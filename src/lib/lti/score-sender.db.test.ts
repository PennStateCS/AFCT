import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createKeyPair } from './keys';
import { queueScore } from './score-queue';
import { sendOneScore } from './score-sender';

/**
 * Draining the grade queue into an LMS, against a real Postgres.
 *
 * The cases that matter are the ones where a grade cannot be sent. Each has to leave the queue
 * row saying why, because a grade that quietly never arrives is the worst outcome here.
 */

const ISSUER = 'https://canvas.example.test';
const PLATFORM = 'ltip-sender';
const COURSE = 'c-sender';
const ASSIGNMENT = 'a-sender';
const USER = 'u-sender';
const LINE_ITEMS_URL = `${ISSUER}/contexts/1/line_items`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A platform that issues tokens, creates columns and accepts scores. */
function workingPlatform() {
  const posted: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/token')) return json({ access_token: 'tok', expires_in: 3600 });
      posted.push(url);
      return json({ id: `${LINE_ITEMS_URL}/42` });
    }),
  );
  return posted;
}

async function destroyFixtures() {
  await prisma.ltiScoreQueue.deleteMany({});
  await prisma.ltiLineItem.deleteMany({});
  await prisma.ltiContextLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.linkedIdentity.deleteMany({ where: { userId: USER } });
  await prisma.assignment.deleteMany({ where: { id: ASSIGNMENT } });
  await prisma.ltiPlatform.deleteMany({ where: { id: PLATFORM } });
  await prisma.course.deleteMany({ where: { id: COURSE } });
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.ltiKeyPair.deleteMany({});
}

/** Everything a working setup needs, minus whatever a test removes. */
async function seed(opts: { withIdentity?: boolean; lineItemsUrl?: string | null } = {}) {
  await createKeyPair();
  await prisma.user.create({ data: { id: USER, email: 'sender@example.test', password: null } });
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
      id: PLATFORM,
      name: 'Canvas',
      issuer: ISSUER,
      clientId: 'client-1',
      deploymentId: '1',
      authLoginUrl: `${ISSUER}/auth`,
      tokenUrl: `${ISSUER}/token`,
      keysetUrl: `${ISSUER}/jwks`,
    },
  });
  await prisma.ltiContextLink.create({
    data: {
      platformId: PLATFORM,
      contextId: 'ctx-1',
      courseId: COURSE,
      lineItemsUrl: opts.lineItemsUrl === undefined ? LINE_ITEMS_URL : opts.lineItemsUrl,
    },
  });
  if (opts.withIdentity !== false) {
    await prisma.linkedIdentity.create({
      data: {
        userId: USER,
        kind: 'LTI',
        issuer: ISSUER,
        subject: 'lms-user-1',
        linkedVia: 'JUST_IN_TIME',
      },
    });
  }
  await queueScore({ assignmentId: ASSIGNMENT, userId: USER, scoreGiven: 88, scoreMaximum: 100 });
}

beforeEach(destroyFixtures);
afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

const row = () => prisma.ltiScoreQueue.findFirstOrThrow();

describe('a grade that can be sent', () => {
  it('reaches the LMS and is marked sent', async () => {
    await seed();
    const posted = workingPlatform();

    expect(await sendOneScore()).toEqual({ status: 'sent' });
    expect(await row()).toMatchObject({ state: 'SENT', lastError: null });
    expect(posted.some((url) => url.endsWith('/scores'))).toBe(true);
  });

  it('creates the gradebook column on the way', async () => {
    await seed();
    workingPlatform();

    await sendOneScore();

    expect(await prisma.ltiLineItem.count()).toBe(1);
  });

  it('does nothing when the queue is empty', async () => {
    expect(await sendOneScore()).toEqual({ status: 'idle' });
  });
});

/**
 * Each of these leaves the grade in the queue with a reason. Faculty seeing fewer grades in
 * their LMS than they awarded, with nothing to explain it, is the failure worth designing out.
 */
describe('a grade that cannot be sent', () => {
  it('says so when the student has never opened AFCT from the LMS', async () => {
    await seed({ withIdentity: false });
    workingPlatform();

    expect(await sendOneScore()).toMatchObject({ status: 'failed', reason: 'no-lms-identity' });
    expect((await row()).lastError).toContain('has not opened AFCT');
  });

  it('says so when the LMS granted no grade scopes', async () => {
    await seed({ lineItemsUrl: null });
    workingPlatform();

    const result = await sendOneScore();

    expect(result).toMatchObject({ status: 'failed', reason: 'no-line-items-endpoint' });
    expect((await row()).state).toBe('FAILED');
  });

  // Worth waiting on: the LMS may simply be down.
  it('retries an unreachable LMS', async () => {
    await seed();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    await sendOneScore();

    const queued = await row();
    expect(queued.state).toBe('PENDING');
    expect(queued.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  /**
   * A refused grade will be refused again. Retrying for a day before telling anyone wastes the
   * time of the person who has to change a registration.
   */
  it('gives up at once on a refusal', async () => {
    await seed();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/token')
          ? json({ access_token: 'tok', expires_in: 3600 })
          : new Response('no such line item', { status: 404 }),
      ),
    );

    await sendOneScore();

    expect((await row()).state).toBe('FAILED');
  });

  it('never leaves a grade claimed but unaccounted for', async () => {
    await seed({ withIdentity: false });
    workingPlatform();

    await sendOneScore();

    const queued = await row();
    expect(queued.attempts).toBe(1);
    expect(queued.lastError).not.toBeNull();
  });
});
