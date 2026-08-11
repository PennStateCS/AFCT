import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, jwtVerify } from 'jose';
import type { JWK } from 'jose';
import { prisma } from '@/lib/prisma';
import { createKeyPair, listPublicJwks } from './keys';
import { buildDeepLinkResponse, deepLinkReturnHtml } from './deep-link';

/**
 * Answering a deep-linking request, against a real Postgres.
 *
 * The direction is reversed here: AFCT signs and the platform verifies, so the check that
 * matters is the same one as the access-token assertion, against the keyset AFCT publishes.
 */

const PLATFORM = { issuer: 'Client', clientId: 'AFCT', deploymentId: '1' };
const RETURN_URL = 'https://lti-ri.imsglobal.org/platforms/6455/deep_links';

const build = (over: Partial<Parameters<typeof buildDeepLinkResponse>[0]> = {}) =>
  buildDeepLinkResponse({
    platform: PLATFORM,
    returnUrl: RETURN_URL,
    data: 'platform-state',
    items: [
      {
        url: 'https://afct.test/api/lti/launch',
        title: 'Problem set 1',
        scoreMaximum: 100,
        assignmentId: 'a-1',
      },
    ],
    ...over,
  });

beforeEach(async () => {
  await prisma.ltiKeyPair.deleteMany({});
});

afterAll(async () => {
  await prisma.ltiKeyPair.deleteMany({});
  await prisma.$disconnect();
});

describe('the signed response', () => {
  /** Exactly what the platform does with it. */
  it('verifies against the keyset AFCT publishes', async () => {
    await createKeyPair();
    const result = await build();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const keyset = createLocalJWKSet({ keys: (await listPublicJwks()) as unknown as JWK[] });
    const { payload } = await jwtVerify(result.jwt, keyset, {
      // Reversed from a launch: AFCT issues, the platform is the audience.
      issuer: PLATFORM.clientId,
      audience: PLATFORM.issuer,
    });

    expect(payload['https://purl.imsglobal.org/spec/lti/claim/message_type']).toBe(
      'LtiDeepLinkingResponse',
    );
  });

  it('carries the chosen assignment so a later launch knows what it opens', async () => {
    await createKeyPair();
    const result = await build();
    if (!result.ok) return;

    const keyset = createLocalJWKSet({ keys: (await listPublicJwks()) as unknown as JWK[] });
    const { payload } = await jwtVerify(result.jwt, keyset, {
      issuer: PLATFORM.clientId,
      audience: PLATFORM.issuer,
    });

    const items = payload['https://purl.imsglobal.org/spec/lti-dl/claim/content_items'] as {
      custom: { afct_assignment_id: string };
      lineItem?: { scoreMaximum: number };
    }[];
    expect(items[0]?.custom.afct_assignment_id).toBe('a-1');
    expect(items[0]?.lineItem?.scoreMaximum).toBe(100);
  });

  /**
   * The platform's own state. Platforms reject a response without it, and it is how they know
   * which placement asked.
   */
  it('returns the platform state exactly as it arrived', async () => {
    await createKeyPair();
    const result = await build();
    if (!result.ok) return;

    const keyset = createLocalJWKSet({ keys: (await listPublicJwks()) as unknown as JWK[] });
    const { payload } = await jwtVerify(result.jwt, keyset, {
      issuer: PLATFORM.clientId,
      audience: PLATFORM.issuer,
    });

    expect(payload['https://purl.imsglobal.org/spec/lti-dl/claim/data']).toBe('platform-state');
  });

  it('says so when AFCT has no key to sign with', async () => {
    expect(await build()).toEqual({ ok: false, reason: 'no-signing-key' });
  });

  it('omits the gradebook column when the assignment is worth nothing', async () => {
    await createKeyPair();
    const result = await build({
      items: [{ url: 'https://afct.test/x', title: 'Practice', assignmentId: 'a-2' }],
    });
    if (!result.ok) return;

    const keyset = createLocalJWKSet({ keys: (await listPublicJwks()) as unknown as JWK[] });
    const { payload } = await jwtVerify(result.jwt, keyset, {
      issuer: PLATFORM.clientId,
      audience: PLATFORM.issuer,
    });
    const items = payload['https://purl.imsglobal.org/spec/lti-dl/claim/content_items'] as {
      lineItem?: unknown;
    }[];
    expect(items[0]?.lineItem).toBeUndefined();
  });
});

/**
 * The page that posts the answer back. In production the CSP is enforced, so a script without
 * the request's nonce never runs and the page would sit there doing nothing.
 */
describe('the returning page', () => {
  it('stamps the script with the CSP nonce', () => {
    const html = deepLinkReturnHtml(RETURN_URL, 'a.b.c', 'nonce-123');

    expect(html).toContain('<script nonce="nonce-123">');
  });

  // A blocked script is not a disabled one, so `<noscript>` would stay hidden.
  it('shows a real button, not one hidden behind noscript', () => {
    const html = deepLinkReturnHtml(RETURN_URL, 'a.b.c', 'n');

    expect(html).toContain('<button type="submit">');
    expect(html).not.toContain('<noscript>');
  });

  it('escapes what it puts in the form', () => {
    const html = deepLinkReturnHtml('https://x.test/"onload="alert(1)', 'a"b', 'n');

    expect(html).not.toContain('onload="alert(1)');
    expect(html).toContain('&quot;');
  });
});
