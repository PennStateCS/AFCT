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
      // The claims Core requires of a resource link launch. Not what this test is about, but a
      // launch without them is refused, and a fixture that could not happen proves nothing.
      [`${CLAIM}/target_link_uri`]: 'https://afct.test/api/lti/launch',
      [`${CLAIM}/resource_link`]: { id: 'rl-azp' },
      [`${CLAIM}/roles`]: [],
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

    expect(await validateLaunch({ idToken: await launchToken() })).toMatchObject({
      ok: false,
      reason: 'unregistered-platform',
    });
  });

  /**
   * Getting one character wrong in a registration is the most common setup failure, and without
   * this the refusal names nothing an administrator can compare against what they typed.
   */
  it('reports what the unregistered launch claimed to be', async () => {
    await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });

    const result = await validateLaunch({ idToken: await launchToken() });

    expect(result).toMatchObject({
      observed: { issuer: ISSUER, clientId: CLIENT_ID, deploymentId: DEPLOYMENT_ID },
    });
  });

  // Only on that one refusal. Everywhere else the claims were either verified or irrelevant.
  it('reports nothing of the sort for a forged signature', async () => {
    const forged = await launchToken({}, attackerKeys.privateKey);

    expect(await validateLaunch({ idToken: forged })).toEqual({
      ok: false,
      reason: 'bad-signature',
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
    expect(await validateLaunch({ idToken: token })).toMatchObject({
      ok: false,
      reason: 'unregistered-platform',
    });
  });

  it('claiming a deployment that is not the registered one', async () => {
    const token = await launchToken({ [`${CLAIM}/deployment_id`]: 'deploy-somewhere-else' });

    expect(await validateLaunch({ idToken: token })).toMatchObject({
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

/**
 * The claims LTI Core requires. A signature proves who sent the token, not that it says enough
 * to act on, and each of these was previously accepted.
 */
describe('claims a launch must carry', () => {
  /** Builds a signed token with full control, so a claim can be left out entirely. */
  const signed = async (claims: Record<string, unknown>, omit: 'exp' | 'iat' | 'sub' | null) => {
    let jwt = new SignJWT({
      [`${CLAIM}/deployment_id`]: DEPLOYMENT_ID,
      [`${CLAIM}/message_type`]: 'LtiResourceLinkRequest',
      [`${CLAIM}/version`]: '1.3.0',
      [`${CLAIM}/roles`]: [],
      [`${CLAIM}/resource_link`]: { id: 'rl-1' },
      [`${CLAIM}/target_link_uri`]: 'https://afct.example.test/api/lti/launch',
      email: 'student@example.test',
      nonce: await issueLaunchNonce(),
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID);
    if (omit !== 'sub') jwt = jwt.setSubject('lms-user-1');
    if (omit !== 'iat') jwt = jwt.setIssuedAt();
    if (omit !== 'exp') jwt = jwt.setExpirationTime('5m');
    return jwt.sign(platformKeys.privateKey);
  };

  /**
   * The worst of them. `String(payload.sub)` turned a missing subject into the string
   * "undefined", so every such launch shared one identity and would have signed each person in
   * as whoever got there first.
   */
  it('refuses a token with no subject', async () => {
    expect(await validateLaunch({ idToken: await signed({}, 'sub') })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  // jose validates `exp` only when it is there, so a token without one never expires.
  it('refuses a token that never expires', async () => {
    expect(await validateLaunch({ idToken: await signed({}, 'exp') })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('refuses a token with no issued-at', async () => {
    expect(await validateLaunch({ idToken: await signed({}, 'iat') })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('refuses a resource link launch with no resource link id', async () => {
    const token = await signed({ [`${CLAIM}/resource_link`]: {} }, null);

    expect(await validateLaunch({ idToken: token })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('refuses a launch with no target link uri', async () => {
    const token = await signed({ [`${CLAIM}/target_link_uri`]: undefined }, null);

    expect(await validateLaunch({ idToken: token })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('refuses a launch with no roles claim', async () => {
    const token = await signed({ [`${CLAIM}/roles`]: undefined }, null);

    expect(await validateLaunch({ idToken: token })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  // Required to be present, allowed to be empty: an LMS may send no roles for a person.
  it('accepts an empty roles list', async () => {
    const result = await validateLaunch({ idToken: await signed({}, null) });

    expect(result.ok).toBe(true);
  });

  /**
   * A deep linking request has no resource link, so requiring one would refuse every deep link.
   */
  it('does not ask a deep linking request for a resource link', async () => {
    const token = await signed(
      {
        [`${CLAIM}/message_type`]: 'LtiDeepLinkingRequest',
        [`${CLAIM}/resource_link`]: undefined,
        'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings': {
          deep_link_return_url: 'https://lms.test/deep_links',
        },
      },
      null,
    );

    expect((await validateLaunch({ idToken: token })).ok).toBe(true);
  });
});
