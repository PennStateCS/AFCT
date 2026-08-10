import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import type { JWK, KeyObject } from 'jose';

/**
 * Validating an LTI launch, against a real Postgres.
 *
 * Only the *network fetch* of the platform's keyset is replaced. Signing and verification are
 * real, done with a real RSA keypair, so a token that should not verify genuinely does not. A
 * suite that mocked `jwtVerify` would prove only that the mock was called, which is worth
 * nothing for the one file in AFCT whose entire job is refusing forged input.
 *
 * The negative cases carry the weight here. Each is somebody getting into a course, as somebody
 * else, on the strength of a token they made up.
 */

const ISSUER = 'https://canvas.example.test';
const CLIENT_ID = 'client-123';
const DEPLOYMENT_ID = 'deploy-1';
const KEYSET_URL = 'https://canvas.example.test/api/lti/security/jwks';
const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim';

// The platform's keypair, and an unrelated one for the forgery cases.
const platformKeys = await generateKeyPair('RS256');
const attackerKeys = await generateKeyPair('RS256');
const platformJwk = {
  ...(await exportJWK(platformKeys.publicKey)),
  kid: 'platform-key',
  alg: 'RS256',
} as JWK;

/**
 * Replaces only the HTTP fetch of the platform's keyset. `jwtVerify` is the real one, so every
 * signature check in these tests is a real signature check.
 */
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return { ...actual, createRemoteJWKSet: () => createLocalJWKSet({ keys: [platformJwk] }) };
});

const { prisma } = await import('@/lib/prisma');
const { validateLaunch, issueLaunchNonce } = await import('./launch');

const platformId = 'ltip-test';

/** A launch token, valid unless a test asks for it to be otherwise. */
async function launchToken(
  over: Record<string, unknown> = {},
  key: KeyObject | CryptoKey = platformKeys.privateKey,
) {
  const claims: Record<string, unknown> = {
    [`${CLAIM}/deployment_id`]: DEPLOYMENT_ID,
    [`${CLAIM}/message_type`]: 'LtiResourceLinkRequest',
    [`${CLAIM}/version`]: '1.3.0',
    [`${CLAIM}/roles`]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
    [`${CLAIM}/context`]: { id: 'ctx-1', title: 'Theory of Computation' },
    [`${CLAIM}/resource_link`]: { id: 'rl-1' },
    [`${CLAIM}/target_link_uri`]: 'https://afct.example.test/api/lti/launch',
    email: 'Student@example.test',
    given_name: 'Ada',
    family_name: 'Lovelace',
    nonce: await issueLaunchNonce(),
    ...over,
  };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setSubject('lms-user-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

async function destroyFixtures() {
  await prisma.singleUseToken.deleteMany({ where: { purpose: 'LTI_LAUNCH_NONCE' } });
  await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.ltiPlatform.create({
    data: {
      id: platformId,
      name: 'Test Canvas',
      issuer: ISSUER,
      clientId: CLIENT_ID,
      deploymentId: DEPLOYMENT_ID,
      authLoginUrl: `${ISSUER}/api/lti/authorize_redirect`,
      tokenUrl: `${ISSUER}/login/oauth2/token`,
      keysetUrl: KEYSET_URL,
    },
  });
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('a launch that should work', () => {
  it('is accepted and says who it is for', async () => {
    const result = await validateLaunch({ idToken: await launchToken() });

    expect(result).toMatchObject({
      ok: true,
      identity: {
        platformId,
        subject: 'lms-user-1',
        email: 'student@example.test',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    });
  });

  it('carries the course and the link that was clicked', async () => {
    const result = await validateLaunch({ idToken: await launchToken() });

    expect(result).toMatchObject({
      ok: true,
      identity: {
        contextId: 'ctx-1',
        contextTitle: 'Theory of Computation',
        resourceLinkId: 'rl-1',
      },
    });
  });

  it('passes the LTI roles through untranslated', async () => {
    const result = await validateLaunch({ idToken: await launchToken() });

    expect(result.ok && result.identity.roles).toEqual([
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
    ]);
  });

  /**
   * A platform may send several audiences. `azp` is what names the one the token is for, and
   * reading the first entry instead would look up the wrong registration and refuse a launch
   * that should have worked.
   */
  it('finds the registration when the platform sends several audiences', async () => {
    const token = await new SignJWT({
      [`${CLAIM}/deployment_id`]: DEPLOYMENT_ID,
      [`${CLAIM}/message_type`]: 'LtiResourceLinkRequest',
      [`${CLAIM}/version`]: '1.3.0',
      email: 'student@example.test',
      azp: CLIENT_ID,
      nonce: await issueLaunchNonce(),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
      .setIssuer(ISSUER)
      .setAudience(['some-other-tool', CLIENT_ID])
      .setSubject('lms-user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(platformKeys.privateKey);

    expect((await validateLaunch({ idToken: token })).ok).toBe(true);
  });

  // Some platforms send only `name`. Used to prefill a profile the person can correct.
  it('falls back to a single name claim when that is all there is', async () => {
    const token = await launchToken({
      given_name: undefined,
      family_name: undefined,
      name: 'Grace Hopper',
    });

    const result = await validateLaunch({ idToken: token });

    expect(result).toMatchObject({
      ok: true,
      identity: { firstName: 'Grace', lastName: 'Hopper' },
    });
  });
});

/**
 * The cases that matter. Each one is somebody getting into a course as somebody else if it
 * passes.
 */
describe('a launch that must be refused', () => {
  it('signed by the wrong key', async () => {
    const forged = await launchToken({}, attackerKeys.privateKey);

    expect(await validateLaunch({ idToken: forged })).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('from an LMS nobody registered', async () => {
    await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });

    expect(await validateLaunch({ idToken: await launchToken() })).toEqual({
      ok: false,
      reason: 'unregistered-platform',
    });
  });

  it('addressed to a different tool', async () => {
    const token = await new SignJWT({
      [`${CLAIM}/deployment_id`]: DEPLOYMENT_ID,
      nonce: await issueLaunchNonce(),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
      .setIssuer(ISSUER)
      .setAudience('some-other-tool')
      .setSubject('lms-user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(platformKeys.privateKey);

    // Never matches a registration, so it cannot even reach signature verification.
    expect(await validateLaunch({ idToken: token })).toEqual({
      ok: false,
      reason: 'unregistered-platform',
    });
  });

  it('claiming a deployment that is not the registered one', async () => {
    const token = await launchToken({ [`${CLAIM}/deployment_id`]: 'deploy-somewhere-else' });

    expect(await validateLaunch({ idToken: token })).toEqual({
      ok: false,
      reason: 'unregistered-platform',
    });
  });

  it('that expired', async () => {
    const token = await new SignJWT({
      [`${CLAIM}/deployment_id`]: DEPLOYMENT_ID,
      [`${CLAIM}/message_type`]: 'LtiResourceLinkRequest',
      [`${CLAIM}/version`]: '1.3.0',
      email: 'student@example.test',
      nonce: await issueLaunchNonce(),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('lms-user-1')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 600)
      .sign(platformKeys.privateKey);

    expect(await validateLaunch({ idToken: token })).toEqual({ ok: false, reason: 'expired' });
  });

  /** The replay case: a captured launch URL, opened a second time. */
  it('replayed with a nonce that has already been spent', async () => {
    const token = await launchToken();

    expect((await validateLaunch({ idToken: token })).ok).toBe(true);
    expect(await validateLaunch({ idToken: token })).toEqual({ ok: false, reason: 'replayed' });
  });

  it('carrying a nonce AFCT never issued', async () => {
    const token = await launchToken({ nonce: 'a-nonce-nobody-issued' });

    expect(await validateLaunch({ idToken: token })).toEqual({ ok: false, reason: 'replayed' });
  });

  it('that is not a resource link launch', async () => {
    const token = await launchToken({ [`${CLAIM}/message_type`]: 'LtiDeepLinkingRequest' });

    expect(await validateLaunch({ idToken: token })).toEqual({
      ok: false,
      reason: 'wrong-message-type',
    });
  });

  it('that is not LTI 1.3', async () => {
    const token = await launchToken({ [`${CLAIM}/version`]: '1.2.0' });

    expect(await validateLaunch({ idToken: token })).toEqual({
      ok: false,
      reason: 'wrong-message-type',
    });
  });

  // Canvas can be configured not to share addresses. Nothing can be done with a nameless person.
  it('carrying no email address', async () => {
    const token = await launchToken({ email: undefined });

    expect(await validateLaunch({ idToken: token })).toEqual({ ok: false, reason: 'no-email' });
  });

  it('that is not a token at all', async () => {
    expect(await validateLaunch({ idToken: 'not-a-jwt' })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

/**
 * A launch that fails for another reason must not burn the nonce, or one clock-skew failure
 * would make the retry fail as a replay and there would be no way out.
 */
describe('the nonce', () => {
  it('survives a launch that failed before it was checked', async () => {
    const nonce = await issueLaunchNonce();
    const rejected = await launchToken({ nonce, [`${CLAIM}/version`]: '1.2.0' });

    await validateLaunch({ idToken: rejected });

    // The same nonce, now on a good token, still works.
    const good = await launchToken({ nonce });
    expect((await validateLaunch({ idToken: good })).ok).toBe(true);
  });
});
