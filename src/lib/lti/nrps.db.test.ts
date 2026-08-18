import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createKeyPair } from './keys';
import { fetchMembership, nrpsFailureMessage } from './nrps';

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

  /**
   * Changed deliberately: this used to skip the entry and return the rest.
   *
   * A skipped member is indistinguishable from a member the LMS never sent, and the caller
   * proposes dropping anybody it did not see. Refusing the read is recoverable; quietly
   * returning a roster one student short is what marks that student as having left.
   */
  it('refuses the read when an entry has no LMS id, rather than dropping them quietly', async () => {
    platformServing([{ body: { members: [member({ user_id: undefined }), member()] } }]);

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'malformed' });
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

/**
 * A partial roster is worse than no roster. The caller diffs this against AFCT's own roster and
 * proposes dropping anyone the LMS did not mention, so a read that stopped early would propose
 * dropping everybody past the point it stopped.
 */
describe('a roster that cannot be read in full', () => {
  it('refuses when pages remain after the limit', async () => {
    // Every page says there is another, so the limit is always reached with more to come.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        const n = Number(new URL(url).searchParams.get('p') ?? '0');
        return json(
          { members: [member({ user_id: `u-${n}`, email: `u${n}@example.test` })] },
          { link: `<${MEMBERSHIPS_URL}?p=${n + 1}>; rel="next"` },
        );
      }),
    );

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'incomplete' });
  });

  // A platform pointing back at a page already read would otherwise spin to the page cap and
  // return the same people several times over.
  it('refuses when the pages loop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        return json(
          { members: [member({ user_id: 'u-1' })] },
          { link: `<${MEMBERSHIPS_URL}>; rel="next"` },
        );
      }),
    );

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'incomplete' });
  });

  it('still returns a roster that ends on its own', async () => {
    platformServing([
      { body: { members: [member({ user_id: 'u-1' })] }, next: `${MEMBERSHIPS_URL}?p=2` },
      { body: { members: [member({ user_id: 'u-2' })] } },
    ]);

    const result = await fetchIt();

    expect(result.ok).toBe(true);
    expect(result.ok && result.members.map((m) => m.ltiUserId)).toEqual(['u-1', 'u-2']);
  });

  it('says what to do about it', () => {
    expect(nrpsFailureMessage('incomplete')).toContain('has not changed anything');
  });
});

/**
 * The roster read carries an OAuth bearer token for the LMS, and the `Link` header that says
 * where the next page lives is the platform's to write. So where that header points is a
 * security question, not a convenience.
 */
describe('where a next page may point', () => {
  const servingNext = (next: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        return json({ members: [member()] }, { link: `<${next}>; rel="next"` });
      }),
    );

  it('follows another page on the same server', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        calls++;
        return calls === 1
          ? json({ members: [member()] }, { link: `<${MEMBERSHIPS_URL}?p=2>; rel="next"` })
          : json({ members: [member({ user_id: 'lms-2' })] });
      }),
    );

    const result = await fetchIt();

    expect(result.ok && result.members.map((m) => m.ltiUserId)).toEqual(['lms-1', 'lms-2']);
  });

  it('refuses to carry the token to another host', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
      return json({ members: [member()] }, { link: '<https://evil.example/collect>; rel="next"' });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'rejected' });
    // The point is not the refusal but that the other host was never called at all.
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('https://evil.example/collect');
  });

  it('refuses a next page that is not a URL', async () => {
    servingNext('javascript:alert(1)');

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'rejected' });
  });

  it('refuses to follow a redirect, which would hand the token on or lose it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === PLATFORM.tokenUrl) return json({ access_token: 'tok', expires_in: 3600 });
        return new Response(null, {
          status: 302,
          headers: { location: 'https://elsewhere.example/members' },
        });
      }),
    );

    const result = await fetchIt();

    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    // Named, because "your LMS redirected us" is something an administrator can act on.
    expect(result.ok === false && result.detail).toContain('elsewhere.example');
  });
});

/**
 * An answer AFCT cannot read must never look like a course with nobody in it. The caller diffs
 * this against AFCT's roster and proposes dropping everyone it did not see, so "empty" and
 * "unreadable" have to be different answers.
 */
describe('a membership container AFCT cannot read', () => {
  const serving = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === PLATFORM.tokenUrl
          ? json({ access_token: 'tok', expires_in: 3600 })
          : json(body as Record<string, unknown>),
      ),
    );

  it.each([
    ['an object with no members', {}],
    ['members that are not a list', { members: 'bad-data' }],
    ['null', null],
  ])('refuses %s rather than reading it as an empty roster', async (_label, body) => {
    serving(body);

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('still accepts a genuinely empty course', async () => {
    // The difference that matters: the LMS said "nobody", which is a complete answer.
    serving({ members: [] });

    expect(await fetchIt()).toMatchObject({ ok: true, members: [] });
  });

  it('refuses a member whose roles are not all strings', async () => {
    // Roles decide whether somebody is enrolled as faculty or as a student, so a list AFCT
    // only partly understands is not one to tidy up. The launch validator is equally strict.
    serving({ members: [member({ roles: ['...#Instructor', 123] })] });

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('refuses a member with no roles at all', async () => {
    serving({ members: [member({ roles: undefined })] });

    expect(await fetchIt()).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('says what to do about it without saying the course is empty', () => {
    const message = nrpsFailureMessage('malformed');
    expect(message).toContain('could not read');
    expect(message).toContain('nothing has been changed');
  });
});
