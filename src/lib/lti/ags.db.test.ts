import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createKeyPair } from './keys';
import { ensureLineItem, postScore, findLtiUserId } from './ags';
import { clearAccessTokenCache } from './access-token';

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

/** The URL the fake platform gives the column it creates. */
const LINE_ITEM_URL = `${LINE_ITEMS_URL}/42`;

/**
 * What a platform keeps on a column that AFCT has no business changing.
 *
 * AGS says a PUT replaces the whole definition, so these are what a careless update destroys:
 * the dates the column is available, the platform's own tag, and whatever extensions it hangs
 * off the line item.
 */
const PLATFORM_OWNED = {
  startDateTime: '2026-01-06T00:00:00Z',
  endDateTime: '2026-05-01T00:00:00Z',
  tag: 'week-one',
  'https://canvas.instructure.com/lti/submission_type': { type: 'external_tool' },
};

/**
 * A platform that answers the way AGS says one should.
 *
 * The shapes are the point. A line item *container* is a JSON array; a single line item is an
 * object; a PUT answers with the column as it now stands. The fake this replaced returned the
 * same body for every GET, so a lookup read a single column as an empty container and an update
 * read a container as a column, and neither showed up because nothing asserted on what came
 * back.
 */
function acceptingPlatform(opts: { existing?: Record<string, unknown> | null } = {}) {
  const calls: {
    url: string;
    body: unknown;
    headers: Record<string, string>;
    method: string;
  }[] = [];
  /** The one column this platform knows about, if any. */
  let stored: Record<string, unknown> | null = opts.existing ?? null;

  const mock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const method = init.method ?? 'GET';
    if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });

    // Checked before the container, since the column's URL starts with the container's.
    const isColumn = url.startsWith(LINE_ITEM_URL) && !url.includes('/scores');

    if (method === 'GET') {
      if (isColumn) return stored ? json(stored) : json({ error: 'gone' }, 404);
      return json(stored ? [stored] : []);
    }

    calls.push({ url, body: JSON.parse(String(init.body)), headers, method });

    if (method === 'PUT') {
      // A real platform returns the updated line item, which is what lets AFCT confirm the
      // maximum actually took rather than trusting the status code.
      stored = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json(stored);
    }
    if (method === 'POST' && !url.includes('/scores')) {
      stored = { ...(JSON.parse(String(init.body)) as object), id: LINE_ITEM_URL };
      return json(stored);
    }
    return json({});
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
        return json([{ resourceId: ASSIGNMENT, id: `${LINE_ITEMS_URL}/55020` }]);
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
        return json([{ resourceId: ASSIGNMENT, id: `${LINE_ITEMS_URL}/existing` }]);
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

/**
 * Whether the column already exists, and what happens when AFCT cannot find out.
 *
 * The lookup used to answer `null` both for "there is no column" and for "I could not tell", and
 * the caller read either as permission to create one. That is how a gradebook ends up with two
 * columns for one assignment, which is confusing for a student and awkward for faculty to
 * unpick. Every case below therefore asserts the same thing twice: the outcome, and that nothing
 * was created.
 */
describe('looking for an existing column', () => {
  /** A platform whose container answers however a test says, with pages if it wants. */
  /**
   * Believing the filter was the wrong-column bug waiting to happen.
   *
   * The request asks for `resource_id=<assignment>` and AGS says a platform should honour it.
   * Canvas does. A platform that does not answers with every column in the course, and taking
   * the first would send every grade for this assignment to another assignment's column: wrong
   * rather than untidy, and silent.
   */
  it('ignores columns the platform returned that are not this assignment’s', async () => {
    const created = pagingPlatform([
      {
        body: [
          // What a platform that ignores the filter sends back.
          { id: `${LINE_ITEMS_URL}/99`, resourceId: 'another-assignment' },
          { id: `${LINE_ITEMS_URL}/7`, resourceId: ASSIGNMENT },
        ],
      },
    ]);

    const result = await ensure();

    expect(result).toEqual({ ok: true, value: `${LINE_ITEMS_URL}/7` });
    // Found the right one, so nothing was created.
    expect(created).toHaveLength(0);
  });

  it('does not adopt a column with no resource id', async () => {
    // These exist: a deep link that sent no `resourceId` leaves the platform holding a column it
    // cannot recognise later, and guessing at it is the same failure from the other direction.
    const created = pagingPlatform([{ body: [{ id: `${LINE_ITEMS_URL}/99` }] }]);

    const result = await ensure();

    // Its own column instead, which is the honest outcome.
    expect(created).toHaveLength(1);
    expect(result.ok).toBe(true);
  });

  it('keeps paging to find this assignment’s column', async () => {
    const created = pagingPlatform([
      {
        body: [{ id: `${LINE_ITEMS_URL}/1`, resourceId: 'other' }],
        next: `${LINE_ITEMS_URL}?page=2`,
      },
      { body: [{ id: `${LINE_ITEMS_URL}/2`, resourceId: ASSIGNMENT }] },
    ]);

    expect(await ensure()).toEqual({ ok: true, value: `${LINE_ITEMS_URL}/2` });
    expect(created).toHaveLength(0);
  });

  function pagingPlatform(pages: Array<{ body: unknown; next?: string; status?: number }>) {
    const created: string[] = [];
    let page = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        if ((init.method ?? 'GET') !== 'GET') {
          created.push(url);
          return json({ id: LINE_ITEM_URL });
        }
        const answer = pages[Math.min(page, pages.length - 1)];
        page += 1;
        if (answer?.status && answer.status >= 400) {
          return new Response('nope', { status: answer.status });
        }
        return new Response(JSON.stringify(answer?.body ?? []), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...(answer?.next ? { Link: `<${answer.next}>; rel="next"` } : {}),
          },
        });
      }),
    );
    return created;
  }

  /** A column of this assignment's, which is what makes it the one to adopt. */
  const column = (id: string) => ({
    id,
    resourceId: ASSIGNMENT,
    label: 'Problem set 1',
    scoreMaximum: 100,
  });

  it('finds one on the first page', async () => {
    const created = pagingPlatform([{ body: [column(LINE_ITEM_URL)] }]);

    expect(await ensure()).toEqual({ ok: true, value: LINE_ITEM_URL });
    expect(created).toHaveLength(0);
  });

  // The reason paging is followed at all: stopping at page one creates a second column.
  it('finds one on a later page', async () => {
    const created = pagingPlatform([
      { body: [], next: `${LINE_ITEMS_URL}?page=2` },
      { body: [], next: `${LINE_ITEMS_URL}?page=3` },
      { body: [column(LINE_ITEM_URL)] },
    ]);

    expect(await ensure()).toEqual({ ok: true, value: LINE_ITEM_URL });
    expect(created).toHaveLength(0);
  });

  // The one case that may create: every page was read and it genuinely was not there.
  it('creates one when every page has been read and it is absent', async () => {
    const created = pagingPlatform([{ body: [] }]);

    expect((await ensure()).ok).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('creates nothing when the pages repeat', async () => {
    const created = pagingPlatform([
      { body: [], next: `${LINE_ITEMS_URL}?resource_id=${ASSIGNMENT}` },
    ]);

    expect(await ensure()).toMatchObject({ ok: false, reason: 'line-item-lookup-incomplete' });
    expect(created).toHaveLength(0);
  });

  // Twenty-one pages of columns, each pointing at another. The list was never exhausted.
  it('creates nothing when the page limit is reached with more to come', async () => {
    let n = 0;
    const created = pagingPlatform(
      Array.from({ length: 25 }, () => ({ body: [], next: `${LINE_ITEMS_URL}?page=${(n += 1)}` })),
    );

    expect(await ensure()).toMatchObject({ ok: false, reason: 'line-item-lookup-incomplete' });
    expect(created).toHaveLength(0);
  });

  // A refusal will be a refusal tomorrow, so it is reported as one rather than retried for a day.
  it('creates nothing when the platform refuses the lookup', async () => {
    const created = pagingPlatform([{ body: null, status: 403 }]);

    expect(await ensure()).toMatchObject({ ok: false, reason: 'rejected' });
    expect(created).toHaveLength(0);
  });

  // A server error is worth waiting on, and still must not create.
  it('creates nothing when the platform errors, and asks to be retried', async () => {
    const created = pagingPlatform([{ body: null, status: 503 }]);

    expect(await ensure()).toMatchObject({ ok: false, reason: 'line-item-lookup-failed' });
    expect(created).toHaveLength(0);
  });

  /**
   * AGS says an empty container "MUST just be an empty array". An object is not an empty list,
   * and reading it as one is exactly the bug: this is what a platform returning an error
   * document, or an HTML page, looks like from here.
   */
  it('creates nothing when the answer is not a list at all', async () => {
    const created = pagingPlatform([{ body: { error: 'unauthorised' } }]);

    expect(await ensure()).toMatchObject({ ok: false, reason: 'line-item-lookup-failed' });
    expect(created).toHaveLength(0);
  });

  it('creates nothing when the platform cannot be reached', async () => {
    const created: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        if ((init.method ?? 'GET') !== 'GET') created.push(url);
        throw new Error('ECONNREFUSED');
      }),
    );

    expect(await ensure()).toMatchObject({ ok: false, reason: 'line-item-lookup-failed' });
    expect(created).toHaveLength(0);
  });

  /**
   * The `Link` header is written by the platform and this request carries a bearer token, so a
   * next page on another host would hand that token to whoever the header named.
   */
  it('will not follow a page onto another server', async () => {
    const created = pagingPlatform([
      { body: [], next: 'https://elsewhere.test/line_items?page=2' },
    ]);

    expect(await ensure()).toMatchObject({ ok: false, reason: 'line-item-lookup-failed' });
    expect(created).toHaveLength(0);
  });
});

/**
 * Changing a column that already exists.
 *
 * A platform scales a score against the column's own maximum, so posting 120 to a column still
 * set out of 100 when the assignment is now out of 150 reports a mark that is simply wrong. The
 * name is cosmetic and is treated as such.
 */
describe('keeping the column in step with the assignment', () => {
  const repoint = (over: { label?: string; scoreMaximum?: number } = {}) =>
    ensureLineItem({
      platform: PLATFORM,
      contextLinkId,
      lineItemsUrl: LINE_ITEMS_URL,
      assignmentId: ASSIGNMENT,
      label: over.label ?? 'Problem set 1',
      scoreMaximum: over.scoreMaximum ?? 100,
    });

  /** A platform that has the column and refuses whatever a test says it should. */
  function stubbornPlatform(opts: { failGet?: boolean; failPut?: boolean; clampTo?: number }) {
    const stored: Record<string, unknown> = {
      id: LINE_ITEM_URL,
      label: 'Problem set 1',
      scoreMaximum: 100,
      ...PLATFORM_OWNED,
    };
    const puts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        const method = init.method ?? 'GET';
        if (method === 'GET') {
          if (opts.failGet) return new Response('no', { status: 500 });
          return json(stored);
        }
        if (method === 'PUT') {
          puts.push(JSON.parse(String(init.body)));
          if (opts.failPut) return new Response('no', { status: 400 });
          const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
          // A platform that quietly keeps its own maximum, which a status code alone hides.
          return json({ ...sent, ...(opts.clampTo ? { scoreMaximum: opts.clampTo } : {}) });
        }
        return json({});
      }),
    );
    return puts;
  }

  /** Put a column in place, then let a test change what the assignment is worth. */
  async function withExistingColumn() {
    acceptingPlatform();
    await ensure();
  }

  it('sends the new maximum and records it', async () => {
    await withExistingColumn();
    const puts = stubbornPlatform({});

    expect(await repoint({ scoreMaximum: 150 })).toEqual({ ok: true, value: LINE_ITEM_URL });
    expect(puts[0]).toMatchObject({ scoreMaximum: 150 });
    expect((await prisma.ltiLineItem.findFirstOrThrow()).scoreMaximum).toBe(150);
  });

  /**
   * AGS: a PUT "replaces the line item definition", so everything the platform owns has to go
   * back with it. Sending only the fields AFCT knows about silently deletes the rest.
   */
  it('puts back everything the platform owns', async () => {
    await withExistingColumn();
    const puts = stubbornPlatform({});

    await repoint({ scoreMaximum: 150 });

    expect(puts[0]).toMatchObject(PLATFORM_OWNED);
  });

  /**
   * The case the whole gate exists for: LMS column out of 100, assignment now out of 150, the
   * update refused. Sending 120/150 anyway would put a wrong mark in the gradebook.
   */
  it('refuses to grade when the maximum could not be changed', async () => {
    await withExistingColumn();
    stubbornPlatform({ failPut: true });

    expect(await repoint({ scoreMaximum: 150 })).toMatchObject({
      ok: false,
      reason: 'line-item-update-failed',
    });
    // Untouched, so the next attempt tries the change again instead of believing it worked.
    expect((await prisma.ltiLineItem.findFirstOrThrow()).scoreMaximum).toBe(100);
  });

  /**
   * A 200 says the platform accepted the request, not that the column now reads 150. One that
   * keeps its own maximum has to be caught by reading the answer, or the same wrong mark goes
   * out with nothing to show for it.
   */
  it('refuses to grade when the platform says it kept the old maximum', async () => {
    await withExistingColumn();
    stubbornPlatform({ clampTo: 100 });

    expect(await repoint({ scoreMaximum: 150 })).toMatchObject({
      ok: false,
      reason: 'line-item-update-failed',
    });
  });

  /**
   * There used to be a fallback here: if the read failed, send a minimal replacement anyway.
   * Since a PUT replaces the whole definition, that discarded everything the platform owned at
   * exactly the moment AFCT knew least about what it was discarding.
   */
  it('sends no replacement at all when the column cannot be read first', async () => {
    await withExistingColumn();
    const puts = stubbornPlatform({ failGet: true });

    expect(await repoint({ scoreMaximum: 150 })).toMatchObject({
      ok: false,
      reason: 'line-item-update-failed',
    });
    expect(puts).toHaveLength(0);
  });

  /**
   * A stale name is a blemish, not a wrong grade, so refusing to grade over one would be the
   * worse trade. The stored copy stays as it was, which is what makes the rename retry later.
   */
  it('still grades when only the name could not be changed', async () => {
    await withExistingColumn();
    stubbornPlatform({ failPut: true });

    expect(await repoint({ label: 'Problem set 1 (revised)' })).toEqual({
      ok: true,
      value: LINE_ITEM_URL,
    });
    expect((await prisma.ltiLineItem.findFirstOrThrow()).label).toBe('Problem set 1');
  });
});

/**
 * AGS grants line-item management and score posting as separate scopes, and a platform that
 * created the column itself may grant only the second. Asking for both then has the token
 * request refused outright, so no grade is sent at all.
 */
describe('the permissions each operation asks for', () => {
  const scopesRequested = (fetchMock: ReturnType<typeof vi.fn>) => {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/token'));
    const body = call?.[1]?.body as URLSearchParams | undefined;
    return String(body?.get('scope') ?? '').split(' ').filter(Boolean);
  };

  it('asks only to post a score when posting a score', async () => {
    // A cold cache, or an earlier test's token answers and no request is made to inspect.
    clearAccessTokenCache();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/token')) return json({ access_token: 'tok', expires_in: 3600 });
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await postScore({
      platform: PLATFORM,
      lineItemUrl: `${ISSUER}/lineitems/1`,
      ltiUserId: 'lms-1',
      scoreGiven: 8,
      scoreMaximum: 10,
    });

    expect(scopesRequested(fetchMock)).toEqual([
      'https://purl.imsglobal.org/spec/lti-ags/scope/score',
    ]);
  });
});
