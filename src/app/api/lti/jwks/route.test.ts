import { expect, it, vi, beforeEach } from 'vitest';

/**
 * The public keyset endpoint.
 *
 * The behaviour worth pinning is that no key is not an error. An install that has never
 * registered an LMS has never needed one, and answering with a 500 would make a healthy system
 * look broken.
 */

const listPublicJwks = vi.hoisted(() => vi.fn());
vi.mock('@/lib/lti/keys', () => ({ listPublicJwks }));

const { GET } = await import('./route');

const jwk = {
  kty: 'RSA',
  use: 'sig',
  alg: 'RS256',
  kid: 'abc',
  n: 'modulus',
  e: 'AQAB',
};

beforeEach(() => vi.clearAllMocks());

it('publishes the keys in a JWKS document', async () => {
  listPublicJwks.mockResolvedValue([jwk]);

  const res = await GET();

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ keys: [jwk] });
});

it('answers with an empty set when no key exists yet', async () => {
  listPublicJwks.mockResolvedValue([]);

  const res = await GET();

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ keys: [] });
});

/**
 * Platforms cache this. Too long and a rotated key is not picked up without someone
 * intervening, which is what makes rotation possible at all.
 */
it('lets platforms cache it, but not indefinitely', async () => {
  listPublicJwks.mockResolvedValue([jwk]);

  const res = await GET();

  expect(res.headers.get('Cache-Control')).toContain('max-age=300');
});
