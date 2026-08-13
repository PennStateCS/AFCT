import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, UnsecuredJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
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
const { validateLaunch } = await import('./launch');
const { startLaunch } = await import('./launch-transaction');

const TARGET_LINK_URI = 'https://afct.example.test/api/lti/launch';

/**
 * The state of the launch each fixture started. A launch is now one record holding both
 * secrets, so a token is only valid alongside the state it was issued with.
 */
let lastState = '';

/** Start a launch and hand back the nonce its token must carry. */
async function beginFixture(targetLinkUri: string | null = TARGET_LINK_URI): Promise<string> {
  try {
    const started = await startLaunch({ platformId, targetLinkUri });
    lastState = started.state;
    return started.nonce;
  } catch {
    // Some cases delete the registration before building a token. Those launches are refused
    // for being unregistered, long before the launch record is read, so any value serves.
    lastState = 'no-launch-was-started';
    return 'no-nonce-was-issued';
  }
}

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
    [`${CLAIM}/target_link_uri`]: TARGET_LINK_URI,
    email: 'Student@example.test',
    given_name: 'Ada',
    family_name: 'Lovelace',
    nonce: typeof over.nonce === 'string' ? over.nonce : await beginFixture(),
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

/**
 * The same token with everything under control: which claims it carries, which of the ones LTI
 * requires it leaves out, when it was issued and when it expires, who it is addressed to, what
 * its header says, and which key signed it.
 *
 * `launchToken` above is the shorthand for a launch that should work. This is what the negative
 * cases use, because each of them is one of these properties turned wrong.
 */
async function signed(
  claims: Record<string, unknown> = {},
  options: {
    omit?: 'exp' | 'iat' | 'sub';
    audience?: string | string[];
    header?: { alg: string; kid?: string };
    issuedAt?: number;
    expiresAt?: number;
    key?: KeyObject | CryptoKey;
  } = {},
) {
  let jwt = new SignJWT({
    [`${CLAIM}/deployment_id`]: DEPLOYMENT_ID,
    [`${CLAIM}/message_type`]: 'LtiResourceLinkRequest',
    [`${CLAIM}/version`]: '1.3.0',
    [`${CLAIM}/roles`]: [],
    [`${CLAIM}/resource_link`]: { id: 'rl-1' },
    [`${CLAIM}/target_link_uri`]: TARGET_LINK_URI,
    email: 'student@example.test',
    nonce: typeof claims.nonce === 'string' ? claims.nonce : await beginFixture(),
    ...claims,
  })
    .setProtectedHeader(options.header ?? { alg: 'RS256', kid: 'platform-key' })
    .setIssuer(ISSUER)
    .setAudience(options.audience ?? CLIENT_ID);
  if (options.omit !== 'sub') jwt = jwt.setSubject('lms-user-1');
  if (options.omit !== 'iat') jwt = jwt.setIssuedAt(options.issuedAt);
  if (options.omit !== 'exp') jwt = jwt.setExpirationTime(options.expiresAt ?? '5m');
  return jwt.sign(options.key ?? platformKeys.privateKey);
}

/** Seconds since the epoch, which is what the time claims are in. */
const nowSeconds = () => Math.floor(Date.now() / 1000);

const DL_SETTINGS_CLAIM = 'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings';

/**
 * Deep linking settings with everything DL 2.0 requires present.
 *
 * The three required fields are spelled out rather than defaulted, because the cases below work
 * by removing exactly one of them and a fixture that was already incomplete would prove nothing.
 */
const deepLinkSettings = (over: Record<string, unknown> = {}) => ({
  deep_link_return_url: 'https://lms.test/deep_links',
  accept_types: ['ltiResourceLink'],
  accept_presentation_document_targets: ['iframe', 'window'],
  ...over,
});

/** A deep linking request, conformant unless a case asks for otherwise. `null` sends no settings. */
const deepLinkClaims = (settings: Record<string, unknown> | null = deepLinkSettings()) => ({
  [`${CLAIM}/message_type`]: 'LtiDeepLinkingRequest',
  [`${CLAIM}/resource_link`]: undefined,
  [DL_SETTINGS_CLAIM]: settings,
});

async function destroyFixtures() {
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
    const result = await validateLaunch({ idToken: await launchToken(), state: lastState });

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
    const result = await validateLaunch({ idToken: await launchToken(), state: lastState });

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
    const result = await validateLaunch({ idToken: await launchToken(), state: lastState });

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
      nonce: await beginFixture(),
      // The claims Core requires of a resource link launch. Not what this test is about, but a
      // launch without them is refused, and a fixture that could not happen proves nothing.
      [`${CLAIM}/target_link_uri`]: TARGET_LINK_URI,
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

    expect((await validateLaunch({ idToken: token, state: lastState })).ok).toBe(true);
  });

  // Some platforms send only `name`. Used to prefill a profile the person can correct.
  it('falls back to a single name claim when that is all there is', async () => {
    const token = await launchToken({
      given_name: undefined,
      family_name: undefined,
      name: 'Grace Hopper',
    });

    const result = await validateLaunch({ idToken: token, state: lastState });

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

    expect(await validateLaunch({ idToken: forged, state: lastState })).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('from an LMS nobody registered', async () => {
    await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });

    expect(await validateLaunch({ idToken: await launchToken(), state: lastState })).toMatchObject({
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

    const result = await validateLaunch({ idToken: await launchToken(), state: lastState });

    expect(result).toMatchObject({
      observed: { issuer: ISSUER, clientId: CLIENT_ID, deploymentId: DEPLOYMENT_ID },
    });
  });

  // Only on that one refusal. Everywhere else the claims were either verified or irrelevant.
  it('reports nothing of the sort for a forged signature', async () => {
    const forged = await launchToken({}, attackerKeys.privateKey);

    expect(await validateLaunch({ idToken: forged, state: lastState })).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('addressed to a different tool', async () => {
    const token = await new SignJWT({
      [`${CLAIM}/deployment_id`]: DEPLOYMENT_ID,
      nonce: await beginFixture(),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
      .setIssuer(ISSUER)
      .setAudience('some-other-tool')
      .setSubject('lms-user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(platformKeys.privateKey);

    // Never matches a registration, so it cannot even reach signature verification.
    expect(await validateLaunch({ idToken: token, state: lastState })).toMatchObject({
      ok: false,
      reason: 'unregistered-platform',
    });
  });

  it('claiming a deployment that is not the registered one', async () => {
    const token = await launchToken({ [`${CLAIM}/deployment_id`]: 'deploy-somewhere-else' });

    expect(await validateLaunch({ idToken: token, state: lastState })).toMatchObject({
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
      nonce: await beginFixture(),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'platform-key' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('lms-user-1')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 600)
      .sign(platformKeys.privateKey);

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({ ok: false, reason: 'expired' });
  });

  /** The replay case: a captured launch URL, opened a second time. */
  it('replayed with a nonce that has already been spent', async () => {
    const token = await launchToken();

    expect((await validateLaunch({ idToken: token, state: lastState })).ok).toBe(true);
    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({ ok: false, reason: 'replayed' });
  });

  it('carrying a nonce AFCT never issued', async () => {
    const token = await launchToken({ nonce: 'a-nonce-nobody-issued' });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({ ok: false, reason: 'replayed' });
  });

  /**
   * A deep linking request is a legitimate message, so this is no longer "not a resource link
   * launch" but "a deep linking request carrying none of the settings that make it one".
   */
  it('that says it is deep linking but brings no settings', async () => {
    const token = await launchToken({ [`${CLAIM}/message_type`]: 'LtiDeepLinkingRequest' });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'deep-link-settings',
    });
  });

  it('that is not LTI 1.3', async () => {
    const token = await launchToken({ [`${CLAIM}/version`]: '1.2.0' });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'wrong-message-type',
    });
  });

  // Canvas can be configured not to share addresses. Nothing can be done with a nameless person.
  it('carrying no email address', async () => {
    const token = await launchToken({ email: undefined });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({ ok: false, reason: 'no-email' });
  });

  it('that is not a token at all', async () => {
    expect(await validateLaunch({ idToken: 'not-a-jwt', state: lastState })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

/**
 * A launch that fails for another reason must not burn the nonce, or one clock-skew failure
 * would make the retry fail as a replay and there would be no way out.
 */
/** The record that ties the state, the nonce, the registration and the target link URI. */
describe('the launch it belongs to', () => {
  it('refuses a state naming no launch at all', async () => {
    const token = await launchToken();

    expect(await validateLaunch({ idToken: token, state: 'a-state-nobody-issued' })).toEqual({
      ok: false,
      reason: 'replayed',
    });
  });

  // The check two loose tokens could not make: a token is only good for its own launch.
  it('refuses a token carrying another launch’s nonce', async () => {
    const other = await beginFixture();
    const token = await launchToken({ nonce: other });
    // A second launch, whose state does not go with that nonce.
    await beginFixture();

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'replayed',
    });
  });

  /**
   * A launch started against one registration cannot be finished by a token belonging to
   * another, even when both tokens verify. Otherwise a second registration on the same LMS
   * would let one launch be completed against the wrong deployment.
   */
  it('refuses a token whose registration is not the one the launch started against', async () => {
    const other = await prisma.ltiPlatform.create({
      data: {
        id: 'ltip-other',
        name: 'Another registration',
        issuer: ISSUER,
        clientId: CLIENT_ID,
        deploymentId: 'deploy-elsewhere',
        authLoginUrl: `${ISSUER}/api/lti/authorize_redirect`,
        tokenUrl: `${ISSUER}/login/oauth2/token`,
        keysetUrl: KEYSET_URL,
      },
    });
    // Started against the other registration; the token below is for the first one.
    const started = await startLaunch({ platformId: other.id, targetLinkUri: TARGET_LINK_URI });
    const token = await launchToken({ nonce: started.nonce });

    expect(await validateLaunch({ idToken: token, state: started.state })).toEqual({
      ok: false,
      reason: 'deployment-mismatch',
    });
  });

  /** Core: the signed target link URI must equal the one the login endpoint was given. */
  it('refuses a target link uri that is not the one asked for', async () => {
    const nonce = await beginFixture('https://afct.example.test/somewhere-else');
    const token = await launchToken({ nonce });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('accepts one that matches', async () => {
    const nonce = await beginFixture(TARGET_LINK_URI);
    const token = await launchToken({ nonce });

    expect((await validateLaunch({ idToken: token, state: lastState })).ok).toBe(true);
  });

  // A platform need not send one to the login endpoint, and then there is nothing to match.
  it('does not ask for a match when the login named no target', async () => {
    const nonce = await beginFixture(null);
    const token = await launchToken({ nonce });

    expect((await validateLaunch({ idToken: token, state: lastState })).ok).toBe(true);
  });
});

describe('the nonce', () => {
  it('survives a launch that failed before it was checked', async () => {
    const nonce = await beginFixture();
    const state = lastState;
    const rejected = await launchToken({ nonce, [`${CLAIM}/version`]: '1.2.0' });

    await validateLaunch({ idToken: rejected, state });

    // The same launch, now on a good token, still works: a failure before the checks that
    // spend it must not cost the person their launch.
    const good = await launchToken({ nonce });
    expect((await validateLaunch({ idToken: good, state })).ok).toBe(true);
  });
});

/**
 * The claims LTI Core requires. A signature proves who sent the token, not that it says enough
 * to act on, and each of these was previously accepted.
 */
describe('claims a launch must carry', () => {
  /**
   * The worst of them. `String(payload.sub)` turned a missing subject into the string
   * "undefined", so every such launch shared one identity and would have signed each person in
   * as whoever got there first.
   *
   * Still refused, under its own name. `sub` came out of the verifier's required claims because
   * Deep Linking does not require it, so this is now AFCT saying it cannot use an anonymous
   * launch rather than jose saying the token is short of a claim.
   */
  it('refuses a token with no subject', async () => {
    expect(
      await validateLaunch({ idToken: await signed({}, { omit: 'sub' }), state: lastState }),
    ).toEqual({ ok: false, reason: 'anonymous-launch' });
  });

  // jose validates `exp` only when it is there, so a token without one never expires.
  it('refuses a token that never expires', async () => {
    expect(await validateLaunch({ idToken: await signed({}, { omit: 'exp' }), state: lastState })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('refuses a token with no issued-at', async () => {
    expect(await validateLaunch({ idToken: await signed({}, { omit: 'iat' }), state: lastState })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('refuses a resource link launch with no resource link id', async () => {
    const token = await signed({ [`${CLAIM}/resource_link`]: {} });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('refuses a launch with no target link uri', async () => {
    const token = await signed({ [`${CLAIM}/target_link_uri`]: undefined });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('refuses a launch with no roles claim', async () => {
    const token = await signed({ [`${CLAIM}/roles`]: undefined });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  // Required to be present, allowed to be empty: an LMS may send no roles for a person.
  it('accepts an empty roles list', async () => {
    const result = await validateLaunch({ idToken: await signed(), state: lastState });

    expect(result.ok).toBe(true);
  });

  /**
   * A deep linking request has no resource link, so requiring one would refuse every deep link.
   */
  it('does not ask a deep linking request for a resource link', async () => {
    const token = await signed(deepLinkClaims());

    expect((await validateLaunch({ idToken: token, state: lastState })).ok).toBe(true);
  });
});

/**
 * Launches that are deliberately wrong, one property at a time.
 *
 * The suite above asks whether a good launch works and whether the obvious forgeries are turned
 * away. This asks the narrower question a conformance run asks: for each thing LTI Core and the
 * Security Framework say about a launch token, what happens when a platform gets exactly that
 * one thing wrong, and does AFCT name the right problem.
 *
 * Naming the right problem is half the point. Every refusal here reaches a person as a sentence
 * telling them what to do next, and sending an administrator to check a registration when the
 * real fault is a server clock costs an afternoon.
 */
describe('deliberately malformed launches', () => {
  describe('the signature', () => {
    /**
     * The classic JWT attack: strip the signature and declare the token unsecured. It has to be
     * refused by the verifier rather than by anything downstream, because every claim in it is
     * whatever the sender wanted it to be.
     */
    it('refuses an unsecured token', async () => {
      const nonce = await beginFixture();
      const token = new UnsecuredJWT({
        [`${CLAIM}/deployment_id`]: DEPLOYMENT_ID,
        [`${CLAIM}/message_type`]: 'LtiResourceLinkRequest',
        [`${CLAIM}/version`]: '1.3.0',
        [`${CLAIM}/roles`]: [],
        [`${CLAIM}/resource_link`]: { id: 'rl-1' },
        [`${CLAIM}/target_link_uri`]: TARGET_LINK_URI,
        email: 'student@example.test',
        nonce,
      })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setSubject('lms-user-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .encode();

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'bad-signature',
      });
    });

    /**
     * A real signature, by a real key, that the platform does not publish. Trusting the header's
     * word for which key to use is how a tool ends up verifying against the attacker's own.
     */
    it('refuses a token naming a key the platform does not publish', async () => {
      const token = await signed({}, { header: { alg: 'RS256', kid: 'a-key-nobody-published' } });

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'bad-signature',
      });
    });
  });

  /**
   * The LMS and AFCT are different machines, so some tolerance is necessary and its size is a
   * security decision. These pin both sides of it.
   */
  describe('the clock', () => {
    it('accepts a token that expired inside the allowed skew', async () => {
      const now = nowSeconds();
      const token = await signed({}, { issuedAt: now - 300, expiresAt: now - 10 });

      expect((await validateLaunch({ idToken: token, state: lastState })).ok).toBe(true);
    });

    it('refuses one that expired outside it', async () => {
      const now = nowSeconds();
      const token = await signed({}, { issuedAt: now - 300, expiresAt: now - 60 });

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'expired',
      });
    });

    /**
     * A token dated next week, expiring a week and five minutes from now. jose checks `iat` only
     * when `maxTokenAge` is set, so before there was an explicit check this verified, and the
     * sender got to decide how long its own token stayed good for.
     */
    it('refuses a token issued in the future', async () => {
      const future = nowSeconds() + 7 * 24 * 60 * 60;
      const token = await signed({}, { issuedAt: future, expiresAt: future + 300 });

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'expired',
      });
    });

    /**
     * Not yet valid is a clock problem, and reporting it as a bad signature sends an
     * administrator to check the registration, which is the wrong place to look.
     */
    it('calls a token that is not valid yet a clock problem, not a forgery', async () => {
      const token = await signed({ nbf: nowSeconds() + 3600 }, { expiresAt: nowSeconds() + 7200 });

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'expired',
      });
    });

    /**
     * The launch record's own window, which is shorter than anything the token says. Reported as
     * a timeout rather than a replay: the person is told the same thing either way, but an
     * administrator reading the log needs to know that nobody is replaying anything.
     */
    it('calls a launch whose window has closed a timeout, not a replay', async () => {
      const started = await startLaunch({
        platformId,
        targetLinkUri: TARGET_LINK_URI,
        ttlMs: -1000,
      });
      const token = await signed({ nonce: started.nonce });

      expect(await validateLaunch({ idToken: token, state: started.state })).toEqual({
        ok: false,
        reason: 'expired',
      });
    });

    /**
     * A launch that was genuinely spent, and one whose state nobody issued, both stay replays.
     * Only the timeout above moved, so this pins that the split did not take the replay case
     * with it.
     */
    it('still calls a spent launch a replay', async () => {
      const token = await signed();
      const state = lastState;

      expect((await validateLaunch({ idToken: token, state })).ok).toBe(true);
      expect(await validateLaunch({ idToken: token, state })).toEqual({
        ok: false,
        reason: 'replayed',
      });
    });
  });

  /**
   * Claims that are present, so nothing that only checks for presence notices, and are not the
   * kind of thing they are declared to be. A signature proves who sent the token, not that a
   * platform serialised it correctly.
   */
  describe('claims of the wrong type', () => {
    /**
     * The subject names the person. A number here read as a string once already, which is how
     * every launch missing a subject came to share one identity.
     *
     * Refused as anonymous rather than malformed: Core says a tool "must interpret the lack of a
     * `sub` claim as a launch request coming from an anonymous user", so the message is not
     * wrong. AFCT is what cannot use it.
     */
    it('refuses a subject that is not a string', async () => {
      const token = await signed({ sub: 12345 }, { omit: 'sub' });

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'anonymous-launch',
      });
    });

    // A single role sent as a bare string rather than a one-element list. Filtering it would
    // silently produce no roles at all, which is a person landing in a course with none.
    it('refuses a roles claim that is not a list', async () => {
      const token = await signed({ [`${CLAIM}/roles`]: 'Learner' });

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'missing-claims',
      });
    });

    it('refuses a nonce that is not a string', async () => {
      const token = await signed({ nonce: 1234567890 });

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'replayed',
      });
    });

    // Blank is the same as absent: there is nothing to identify a person by.
    it('refuses an email that is only whitespace', async () => {
      const token = await signed({ email: '   ' });

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'no-email',
      });
    });
  });

  describe('the shape of the message', () => {
    it('refuses a token that does not say what kind of message it is', async () => {
      const token = await signed({ [`${CLAIM}/message_type`]: undefined });

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'wrong-message-type',
      });
    });

    /**
     * A deep linking request with settings but no return URL. Accepting it would let staff pick
     * an assignment and then have the answer go nowhere, with nothing to say why.
     */
    it('refuses a deep linking request with nowhere to send the answer', async () => {
      const token = await signed(
        deepLinkClaims(deepLinkSettings({ deep_link_return_url: undefined })),
      );

      expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
        ok: false,
        reason: 'deep-link-settings',
      });
    });
  });

  /**
   * When a token is addressed to more than one party, OIDC requires `azp` to name the one it is
   * actually for. Without it there is nothing that says this launch is ours, and guessing at the
   * list would be the tool deciding a token was addressed to it.
   */
  it('refuses several audiences with nothing saying which is ours', async () => {
    const token = await signed({}, { audience: ['some-other-tool', CLIENT_ID] });

    expect(await validateLaunch({ idToken: token, state: lastState })).toMatchObject({
      ok: false,
      reason: 'unregistered-platform',
    });
  });

  /**
   * Two copies of one launch arriving together, which is what a double-clicked link does. The
   * launch is spent with a conditional update rather than a read followed by a write, so exactly
   * one of them may pass; a check-then-act would let both through.
   */
  it('lets exactly one of two simultaneous copies of a launch through', async () => {
    const token = await signed();
    const state = lastState;

    const outcomes = await Promise.all([
      validateLaunch({ idToken: token, state }),
      validateLaunch({ idToken: token, state }),
    ]);

    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.filter((r) => !r.ok && r.reason === 'replayed')).toHaveLength(1);
  });
});

/**
 * Deep linking is a different message with different rules, and reading Core's requirements onto
 * it refuses launches a conformant platform is entitled to send.
 *
 * The one that matters is `sub`. Deep Linking 2.0 removed it outright ("sub is no longer
 * required for Deep Linking Launch for the User"), and roles are listed as optional. AFCT still
 * cannot *use* an anonymous request, but that is AFCT's limit rather than the platform's mistake,
 * and the two are refused under different names so an administrator is sent to the right place.
 */
describe('a deep linking request', () => {
  it('is accepted when it carries the settings the spec requires', async () => {
    const result = await validateLaunch({
      idToken: await signed(deepLinkClaims()),
      state: lastState,
    });

    expect(result).toMatchObject({
      ok: true,
      identity: {
        deepLink: {
          returnUrl: 'https://lms.test/deep_links',
          acceptTypes: ['ltiResourceLink'],
          acceptPresentationDocumentTargets: ['iframe', 'window'],
        },
      },
    });
  });

  /**
   * The protocol case. A resource link launch without a subject is refused for being anonymous;
   * so is this one, but only after its own claims have been checked, and never as `missing-claims`
   * as though the platform had left something out.
   */
  it('is not called malformed merely for having no subject', async () => {
    const token = await signed(deepLinkClaims(), { omit: 'sub' });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'anonymous-launch',
    });
  });

  // Deep Linking 2.0 lists roles as optional, so their absence is not a refusal.
  it('does not require a roles claim', async () => {
    const token = await signed({ ...deepLinkClaims(), [`${CLAIM}/roles`]: undefined });

    expect((await validateLaunch({ idToken: token, state: lastState })).ok).toBe(true);
  });

  // Core keeps requiring it of every message, deep linking included.
  it('still has to say what it is opening', async () => {
    const token = await signed({ ...deepLinkClaims(), [`${CLAIM}/target_link_uri`]: undefined });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  // Both are required by DL 2.0, and an absent one is not "no restriction".
  it('refuses settings with no accepted types', async () => {
    const token = await signed(deepLinkClaims(deepLinkSettings({ accept_types: undefined })));

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'deep-link-settings',
    });
  });

  it('refuses settings with no presentation targets', async () => {
    const token = await signed(
      deepLinkClaims(deepLinkSettings({ accept_presentation_document_targets: undefined })),
    );

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'deep-link-settings',
    });
  });

  it('refuses a deep linking claim with no settings object at all', async () => {
    const token = await signed(deepLinkClaims(null));

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'deep-link-settings',
    });
  });

  /**
   * A placement that takes files but not links is a legitimate thing to configure. AFCT has
   * nothing to offer it, which is a different problem from a malformed request and gets said
   * differently: there is nothing for an administrator to repair.
   */
  it('refuses a placement that will not take a link to a resource', async () => {
    const token = await signed(
      deepLinkClaims(deepLinkSettings({ accept_types: ['file', 'html'] })),
    );

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'content-type-not-accepted',
    });
  });

  /**
   * The three states of `accept_lineitem`. The spec says an absent one means "no assumption can
   * be made about the support of line items", so it has to survive as null rather than being
   * flattened into either answer.
   */
  it('keeps whether the platform takes a gradebook column, including not saying', async () => {
    const states: Array<[Record<string, unknown>, boolean | null]> = [
      [deepLinkSettings({ accept_lineitem: true }), true],
      [deepLinkSettings({ accept_lineitem: false }), false],
      [deepLinkSettings(), null],
    ];

    for (const [settings, expected] of states) {
      const result = await validateLaunch({
        idToken: await signed(deepLinkClaims(settings)),
        state: lastState,
      });

      expect(result.ok && result.identity.deepLink?.acceptLineItem).toBe(expected);
    }
  });
});

/**
 * A resource link launch keeps every requirement Core puts on it. The point of the split is that
 * deep linking stopped inheriting these, not that they were relaxed.
 */
describe('a resource link launch still requires', () => {
  it('a subject', async () => {
    expect(await validateLaunch({ idToken: await signed({}, { omit: 'sub' }), state: lastState })).toEqual(
      { ok: false, reason: 'anonymous-launch' },
    );
  });

  it('a roles claim', async () => {
    const token = await signed({ [`${CLAIM}/roles`]: undefined });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });

  it('a resource link id', async () => {
    const token = await signed({ [`${CLAIM}/resource_link`]: {} });

    expect(await validateLaunch({ idToken: token, state: lastState })).toEqual({
      ok: false,
      reason: 'missing-claims',
    });
  });
});
