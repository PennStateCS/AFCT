import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, jwtVerify, decodeProtectedHeader } from 'jose';
import type { JWK } from 'jose';
import { prisma } from '@/lib/prisma';
import { createKeyPair, listPublicJwks } from './keys';
import { getAccessToken, AGS_SCOPES } from './access-token';

/**
 * Asking an LMS for an access token, against a real Postgres.
 *
 * The check worth having is that the assertion AFCT signs actually verifies against the keyset
 * AFCT publishes, because that is precisely what the platform does with it. Everything else
 * could pass while those two disagree, and the only symptom would be a refusal from the LMS
 * with no explanation on our side.
 */

const TOKEN_URL = 'https://canvas.example.test/login/oauth2/token';
const CLIENT_ID = 'client-123';

/** Each test gets its own platform id, so the token cache cannot leak between them. */
let counter = 0;
const nextPlatform = () => `ltip-token-${counter++}`;

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** The form body AFCT posted, parsed. */
function postedBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return new URLSearchParams(init.body as string);
}

beforeEach(async () => {
  await prisma.ltiKeyPair.deleteMany({});
  // The registrations these tests create. Left behind, they collide with their own ids on the
  // next run, since the counter that names them restarts and the rows do not.
  await prisma.ltiPlatform.deleteMany({ where: { id: { startsWith: 'ltip-token-' } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okResponse({ access_token: 'platform-token', expires_in: 3600 })),
  );
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await prisma.ltiKeyPair.deleteMany({});
  await prisma.$disconnect();
});

describe('the assertion AFCT signs', () => {
  /**
   * The one that matters. The platform fetches AFCT's keyset and verifies the assertion against
   * it; if the two ever diverge, every service call fails at the far end.
   */
  it('verifies against the keyset AFCT publishes', async () => {
    await createKeyPair();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await getAccessToken({ platformId: nextPlatform(), clientId: CLIENT_ID, tokenUrl: TOKEN_URL });

    const assertion = postedBody(fetchMock).get('client_assertion')!;
    const keyset = createLocalJWKSet({ keys: (await listPublicJwks()) as unknown as JWK[] });

    const { payload } = await jwtVerify(assertion, keyset, {
      issuer: CLIENT_ID,
      // The platform's token endpoint, which is what stops an assertion captured by one
      // platform being replayed against another.
      audience: TOKEN_URL,
    });
    expect(payload.sub).toBe(CLIENT_ID);
  });

  /**
   * The one platform that wants an audience of its own.
   *
   * D2L Brightspace issues a `BrightspaceAudience` separately from its access token URL and
   * refuses an assertion addressed to the endpoint, so without this nothing AFCT sends to a
   * Brightspace course would ever arrive. Canvas, Moodle and Blackboard all want the endpoint,
   * which is why it stays the default.
   */
  it('addresses the assertion to a platform’s own audience when it has one', async () => {
    await createKeyPair();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const platformId = nextPlatform();
    const audience = 'https://api.brightspace.example/auth/token';
    await prisma.ltiPlatform.create({
      data: {
        id: platformId,
        name: 'Brightspace',
        issuer: `https://brightspace.example/${platformId}`,
        clientId: CLIENT_ID,
        deploymentId: 'd-1',
        authLoginUrl: 'https://brightspace.example/auth',
        tokenUrl: TOKEN_URL,
        tokenAudience: audience,
        keysetUrl: 'https://brightspace.example/jwks',
      },
    });

    await getAccessToken({ platformId, clientId: CLIENT_ID, tokenUrl: TOKEN_URL });

    const assertion = postedBody(fetchMock).get('client_assertion')!;
    const keyset = createLocalJWKSet({ keys: (await listPublicJwks()) as unknown as JWK[] });
    // Verifying against the audience is the assertion: a mismatch throws here.
    const { payload } = await jwtVerify(assertion, keyset, { issuer: CLIENT_ID, audience });
    expect(payload.aud).toBe(audience);
  });

  it('falls back to the token endpoint when the platform named no audience', async () => {
    // Which is every platform but one, so this is the path that must not change.
    await createKeyPair();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const platformId = nextPlatform();
    await prisma.ltiPlatform.create({
      data: {
        id: platformId,
        name: 'Canvas',
        issuer: `https://canvas.example/${platformId}`,
        clientId: CLIENT_ID,
        deploymentId: 'd-1',
        authLoginUrl: 'https://canvas.example/auth',
        tokenUrl: TOKEN_URL,
        keysetUrl: 'https://canvas.example/jwks',
      },
    });

    await getAccessToken({ platformId, clientId: CLIENT_ID, tokenUrl: TOKEN_URL });

    const assertion = postedBody(fetchMock).get('client_assertion')!;
    const keyset = createLocalJWKSet({ keys: (await listPublicJwks()) as unknown as JWK[] });
    const { payload } = await jwtVerify(assertion, keyset, {
      issuer: CLIENT_ID,
      audience: TOKEN_URL,
    });
    expect(payload.aud).toBe(TOKEN_URL);
  });

  it('names the key it was signed with, so the platform knows which to check', async () => {
    const { kid } = await createKeyPair();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await getAccessToken({ platformId: nextPlatform(), clientId: CLIENT_ID, tokenUrl: TOKEN_URL });

    const assertion = postedBody(fetchMock).get('client_assertion')!;
    expect(decodeProtectedHeader(assertion)).toMatchObject({ alg: 'RS256', kid });
  });

  // Platforms reject a repeated jti, which is the point of it.
  it('is different every time', async () => {
    await createKeyPair();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await getAccessToken({ platformId: nextPlatform(), clientId: CLIENT_ID, tokenUrl: TOKEN_URL });
    await getAccessToken({ platformId: nextPlatform(), clientId: CLIENT_ID, tokenUrl: TOKEN_URL });

    const first = postedBody(fetchMock).get('client_assertion');
    const second = new URLSearchParams(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).body as string,
    ).get('client_assertion');
    expect(first).not.toBe(second);
  });
});

describe('the request it makes', () => {
  it('asks for the grade scopes with a client-credentials grant', async () => {
    await createKeyPair();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await getAccessToken({ platformId: nextPlatform(), clientId: CLIENT_ID, tokenUrl: TOKEN_URL });

    const body = postedBody(fetchMock);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );
    expect(body.get('scope')).toBe(AGS_SCOPES.join(' '));
  });
});

describe('caching', () => {
  // Platforms rate-limit this endpoint, and a sync that asked per score would be slow and rude.
  it('reuses a token rather than asking again', async () => {
    await createKeyPair();
    const platformId = nextPlatform();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await getAccessToken({ platformId, clientId: CLIENT_ID, tokenUrl: TOKEN_URL });
    const second = await getAccessToken({ platformId, clientId: CLIENT_ID, tokenUrl: TOKEN_URL });

    expect(second).toEqual({ ok: true, token: 'platform-token' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again once the token is nearly expired', async () => {
    await createKeyPair();
    const platformId = nextPlatform();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    const start = 1_000_000;
    await getAccessToken({ platformId, clientId: CLIENT_ID, tokenUrl: TOKEN_URL, now: start });
    await getAccessToken({
      platformId,
      clientId: CLIENT_ID,
      tokenUrl: TOKEN_URL,
      // Inside the safety margin before the hour is up.
      now: start + 3600_000 - 10_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps platforms apart', async () => {
    await createKeyPair();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await getAccessToken({ platformId: nextPlatform(), clientId: CLIENT_ID, tokenUrl: TOKEN_URL });
    await getAccessToken({ platformId: nextPlatform(), clientId: CLIENT_ID, tokenUrl: TOKEN_URL });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('when it cannot get one', () => {
  it('says so when AFCT has no key to sign with', async () => {
    const result = await getAccessToken({
      platformId: nextPlatform(),
      clientId: CLIENT_ID,
      tokenUrl: TOKEN_URL,
    });

    expect(result).toEqual({ ok: false, reason: 'no-signing-key' });
  });

  /**
   * The platform's own words are kept: they usually name which of the many setup mistakes this
   * is, and an administrator needs that far more than a status code.
   */
  it('keeps what the platform said when it refuses', async () => {
    await createKeyPair();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid_client"}', { status: 401 })),
    );

    const result = await getAccessToken({
      platformId: nextPlatform(),
      clientId: CLIENT_ID,
      tokenUrl: TOKEN_URL,
    });

    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    expect(result.ok === false && result.detail).toContain('invalid_client');
  });

  it('reports an unreachable platform separately from a refusal', async () => {
    await createKeyPair();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      }),
    );

    const result = await getAccessToken({
      platformId: nextPlatform(),
      clientId: CLIENT_ID,
      tokenUrl: TOKEN_URL,
    });

    expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('refuses a success response that carries no token', async () => {
    await createKeyPair();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ expires_in: 3600 })),
    );

    const result = await getAccessToken({
      platformId: nextPlatform(),
      clientId: CLIENT_ID,
      tokenUrl: TOKEN_URL,
    });

    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
  });
});

/**
 * The request that carries the client assertion.
 *
 * That assertion is a credential AFCT signs for one audience, so where the POST goes is not the
 * platform's to change mid-flight: a 307 or 308 resends the body, credential and all.
 */
describe('the token request itself', () => {
  // These two care about the request, not the assertion, but a signing key still has to exist
  // for one to be built at all.
  beforeEach(async () => {
    await createKeyPair();
  });

  it('refuses a redirect rather than resending the assertion elsewhere', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 307, headers: { location: 'https://evil.example/token' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getAccessToken({
      platformId: nextPlatform(),
      clientId: CLIENT_ID,
      tokenUrl: TOKEN_URL,
    });

    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    expect(result.ok === false && result.detail).toContain('evil.example');
    // One call: the redirect was reported, not followed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not wait on a platform for ever', async () => {
    // A token request runs while somebody waits for a grade, and in the worker the queue waits
    // behind it, so an unbounded request is a stall rather than a slow answer.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'tok', expires_in: 60 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );

    expect(
      await getAccessToken({
        platformId: nextPlatform(),
        clientId: CLIENT_ID,
        tokenUrl: TOKEN_URL,
      }),
    ).toMatchObject({ ok: true });
  });
});

/**
 * What the platform hands back, checked before it is used. Every service call presents the
 * token as a bearer credential, so a token issued as something else would be refused later, at
 * the service, as an unexplained rejection of a grade.
 */
describe('the answer from the token endpoint', () => {
  // A signing key, since the assertion is signed before the answer is read at all.
  beforeEach(async () => {
    await createKeyPair();
  });

  // Each test uses its own platform id, so the cache cannot answer for it.
  const ask = () =>
    getAccessToken({ platformId: nextPlatform(), clientId: CLIENT_ID, tokenUrl: TOKEN_URL });

  it('refuses a token that is not a bearer token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ access_token: 'tok', token_type: 'mac', expires_in: 3600 })),
    );

    const result = await ask();

    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
  });

  it('accepts Bearer however the platform spells it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 })),
    );

    expect((await ask()).ok).toBe(true);
  });

  it('accepts a platform that says nothing about the type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ access_token: 'tok', expires_in: 3600 })));

    expect((await ask()).ok).toBe(true);
  });

  /** A lifetime that is not a usable number is treated as absent, not believed. */
  it('does not take an expiry that would make the token already dead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ access_token: 'tok', expires_in: 0 })));

    const platformId = nextPlatform();
    const first = await getAccessToken({ platformId, clientId: CLIENT_ID, tokenUrl: TOKEN_URL });
    expect(first.ok).toBe(true);

    // Cached, rather than re-requested on every call because it expired the instant it arrived.
    const fetchMock = vi.fn(async () => okResponse({ access_token: 'second', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);
    await getAccessToken({ platformId, clientId: CLIENT_ID, tokenUrl: TOKEN_URL });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
