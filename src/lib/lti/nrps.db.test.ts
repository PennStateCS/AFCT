import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createKeyPair } from './keys';
import { fetchMembership } from './nrps';

/**
 * Reading a course roster from an LMS, against a real Postgres.
 *
 * Two things carry the weight. Paging, because a real course arrives in pages and stopping at
 * the first one silently loses students. And the active flag, because a dropped student is
 * reported rather than omitted, and treating them as absent instead of dropped is the
 * difference between "not enrolled yet" and "removed".
 */

const ISSUER = 'https://canvas.example.test';
const PLATFORM = { id: 'ltip-nrps', clientId: 'client-1', tokenUrl: `${ISSUER}/token` };
const MEMBERSHIPS_URL = `${ISSUER}/contexts/1/memberships`;

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const member = (over: Record<string, unknown> = {}) => ({
  user_id: 'lms-1',
  email: 'Ada@example.test',
  given_name: 'Ada',
  family_name: 'Lovelace',
  roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
  status: 'Active',
  ...over,
});

beforeEach(async () => {
  await prisma.ltiKeyPair.deleteMany({});
  await createKeyPair();
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await prisma.ltiKeyPair.deleteMany({});
  await prisma.$disconnect();
});

/** A platform that hands out a token and then serves the given pages in order. */
function platformServing(pages: { body: unknown; next?: string }[]) {
  let page = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
      const current = pages[page++];
      return json(
        current?.body ?? { members: [] },
        current?.next ? { link: `<${current.next}>; rel="next"` } : {},
      );
    }),
  );
}

const fetchIt = () => fetchMembership({ platform: PLATFORM, membershipsUrl: MEMBERSHIPS_URL });

describe('reading the roster', () => {
  it('returns the people the LMS lists', async () => {
    platformServing([{ body: { members: [member()] } }]);

    const result = await fetchIt();

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.members[0]).toMatchObject({
      ltiUserId: 'lms-1',
      email: 'ada@example.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
      active: true,
    });
  });

  /**
   * A real course arrives in pages. Stopping at the first silently loses students, and nothing
   * downstream could tell that had happened.
   */
  it('follows pages to the end', async () => {
    platformServing([
      { body: { members: [member({ user_id: 'lms-1' })] }, next: `${MEMBERSHIPS_URL}?page=2` },
      { body: { members: [member({ user_id: 'lms-2' })] }, next: `${MEMBERSHIPS_URL}?page=3` },
      { body: { members: [member({ user_id: 'lms-3' })] } },
    ]);

    const result = await fetchIt();

    expect(result.ok && result.members.map((m) => m.ltiUserId)).toEqual([
      'lms-1',
      'lms-2',
      'lms-3',
    ]);
  });

  it('ignores a Link header that offers no next page', async () => {
    platformServing([{ body: { members: [member()] } }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === PLATFORM.tokenUrl
          ? json({ access_token: 'tok', expires_in: 3600 })
          : json({ members: [member()] }, { link: `<${MEMBERSHIPS_URL}?page=1>; rel="prev"` }),
      ),
    );

    const result = await fetchIt();

    expect(result.ok && result.members).toHaveLength(1);
  });

  /**
   * A dropped student is reported rather than omitted. Treating them as absent would make a
   * drop look like somebody who was never enrolled.
   */
  it('marks a dropped student inactive rather than dropping them from the list', async () => {
    platformServing([
      { body: { members: [member({ status: 'Inactive' }), member({ user_id: 'lms-2' })] } },
    ]);

    const result = await fetchIt();

    expect(result.ok && result.members.map((m) => m.active)).toEqual([false, true]);
  });

  it('keeps somebody the LMS shares no address for', async () => {
    platformServing([{ body: { members: [member({ email: undefined })] } }]);

    const result = await fetchIt();

    expect(result.ok && result.members[0]).toMatchObject({ ltiUserId: 'lms-1', email: null });
  });

  // Without an LMS id there is nothing to post a grade against, so the row is useless.
  it('skips an entry with no LMS id', async () => {
    platformServing([{ body: { members: [member({ user_id: undefined }), member()] } }]);

    const result = await fetchIt();

    expect(result.ok && result.members).toHaveLength(1);
  });
});

describe('when the roster cannot be read', () => {
  it('says so when the platform granted no roster scope', async () => {
    const result = await fetchMembership({ platform: PLATFORM, membershipsUrl: null });

    expect(result).toEqual({ ok: false, reason: 'no-endpoint' });
  });

  it('separates a refusal from an unreachable LMS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === PLATFORM.tokenUrl
          ? json({ access_token: 'tok', expires_in: 3600 })
          : new Response('not installed in this course', { status: 403 }),
      ),
    );

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'rejected' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        throw new Error('ECONNREFUSED');
      }),
    );

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});
