import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { beginLaunch, LAUNCH_STATE_TTL_MS } from './login-init';

/**
 * Starting a launch, against a real Postgres.
 *
 * Everything arriving here is attacker-controllable and unauthenticated, so the interesting
 * cases are which registration gets picked and what happens when that is not answerable.
 */

const ISSUER = 'https://canvas.example.test';
const REDIRECT = 'https://afct.example.test/api/lti/launch';

async function destroyFixtures() {
  // Emptied rather than narrowed, so the "mints nothing" case below can count the whole table.
  // The database suite runs its files one at a time, so there is nothing else in it to disturb.
  await prisma.ltiLaunchTransaction.deleteMany({});
  await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });
}

const platform = (over: Record<string, string> = {}) => ({
  name: 'Test Canvas',
  issuer: ISSUER,
  clientId: 'client-123',
  deploymentId: 'deploy-1',
  authLoginUrl: `${ISSUER}/api/lti/authorize_redirect`,
  tokenUrl: `${ISSUER}/login/oauth2/token`,
  keysetUrl: `${ISSUER}/api/lti/security/jwks`,
  ...over,
});

/** What the platform says it wants opened; the launch remembers it to check the token against. */
const TARGET_LINK_URI = 'https://afct.example.test/api/lti/launch';

const begin = (params: Record<string, string> = {}) =>
  beginLaunch({
    params: {
      iss: ISSUER,
      login_hint: 'lms-user-1',
      target_link_uri: TARGET_LINK_URI,
      ...params,
    },
    redirectUri: REDIRECT,
  });

/** The query the browser is sent on with. */
const queryOf = (url: string) => new URL(url).searchParams;

beforeEach(async () => {
  await destroyFixtures();
  await prisma.ltiPlatform.create({ data: platform() });
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('the redirect it builds', () => {
  it('sends the browser to the platform, asking for a form-posted token', async () => {
    const result = await begin();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const query = queryOf(result.redirectUrl);
    expect(result.redirectUrl.startsWith(`${ISSUER}/api/lti/authorize_redirect`)).toBe(true);
    expect(query.get('response_type')).toBe('id_token');
    expect(query.get('response_mode')).toBe('form_post');
    expect(query.get('scope')).toBe('openid');
  });

  // The platform has already authenticated this person. Asking it to prompt again would show
  // somebody a login screen inside an LMS they are already signed in to.
  it('asks the platform not to prompt again', async () => {
    const result = await begin();

    expect(result.ok && queryOf(result.redirectUrl).get('prompt')).toBe('none');
  });

  it('sends back the client id and redirect uri the LMS will check', async () => {
    const result = await begin();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const query = queryOf(result.redirectUrl);
    expect(query.get('client_id')).toBe('client-123');
    expect(query.get('redirect_uri')).toBe(REDIRECT);
  });

  it('passes the message hint through when the platform sends one', async () => {
    const result = await begin({ lti_message_hint: 'hint-abc' });

    expect(result.ok && queryOf(result.redirectUrl).get('lti_message_hint')).toBe('hint-abc');
  });
});

describe('the two secrets it mints', () => {
  it('puts both a state and a nonce in the redirect', async () => {
    const result = await begin();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const query = queryOf(result.redirectUrl);
    expect(query.get('state')).toBeTruthy();
    expect(query.get('nonce')).toBeTruthy();
    expect(query.get('state')).not.toBe(query.get('nonce'));
  });

  it('records them on one launch, so the pair can be checked against each other', async () => {
    await begin();

    const launches = await prisma.ltiLaunchTransaction.findMany();
    expect(launches).toHaveLength(1);
    // Hashes, never the values themselves: the state travels in the browser and the nonce in
    // the id_token, so a leaked database must not let either be forged.
    expect(launches[0]?.stateHash).toHaveLength(64);
    expect(launches[0]?.nonceHash).toHaveLength(64);
    expect(launches[0]?.usedAt).toBeNull();
  });

  /** The binding that two loose tokens could not express. */
  it('remembers the registration and the target link uri it was asked for', async () => {
    await begin();

    const launch = await prisma.ltiLaunchTransaction.findFirstOrThrow();
    expect(launch.platformId).toBeTruthy();
    expect(launch.targetLinkUri).toBe(TARGET_LINK_URI);
  });

  it('gives every launch its own pair', async () => {
    const first = await begin();
    const second = await begin();

    expect(first.ok && second.ok && first.state).not.toBe(second.ok && second.state);
  });

  // Short on purpose: this covers one redirect out and back, not a sign-in session.
  it('expires them within minutes, not hours', async () => {
    await begin();

    const launch = await prisma.ltiLaunchTransaction.findFirstOrThrow();
    const lifetime = launch.expiresAt.getTime() - launch.createdAt.getTime();
    expect(lifetime).toBeLessThanOrEqual(LAUNCH_STATE_TTL_MS + 1000);
  });
});

describe('picking the registration', () => {
  it('narrows by client id when the platform sends one', async () => {
    await prisma.ltiPlatform.create({ data: platform({ clientId: 'client-999' }) });

    const result = await begin({ client_id: 'client-999' });

    expect(result.ok && queryOf(result.redirectUrl).get('client_id')).toBe('client-999');
  });

  /**
   * `client_id` is optional in a login request, so one LMS with AFCT installed twice is
   * genuinely ambiguous. Refused rather than guessed: picking one sends the person into a launch
   * that then fails verification against a different registration, which is far harder to
   * diagnose than being told the registration is duplicated.
   */
  it('refuses rather than guessing when the issuer matches two registrations', async () => {
    await prisma.ltiPlatform.create({ data: platform({ clientId: 'client-999' }) });

    expect(await begin()).toEqual({ ok: false, reason: 'ambiguous-platform' });
  });

  it('refuses an LMS nobody registered', async () => {
    await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });

    expect(await begin()).toEqual({ ok: false, reason: 'unregistered-platform' });
  });

  /**
   * Both are required parameters of a third-party initiated login. Forwarding an empty
   * `login_hint` produced a launch that failed at the platform instead, with nothing pointing
   * back to the request that caused it.
   */
  it('refuses a request that does not say who is launching', async () => {
    const result = await begin({ login_hint: '' });

    expect(result).toEqual({ ok: false, reason: 'missing-login-hint' });
  });

  it('refuses a request that does not say what it is opening', async () => {
    const result = await begin({ target_link_uri: '   ' });

    expect(result).toEqual({ ok: false, reason: 'missing-target-link-uri' });
  });

  it('refuses a request that does not say where it came from', async () => {
    const result = await beginLaunch({ params: { iss: null }, redirectUri: REDIRECT });

    expect(result).toEqual({ ok: false, reason: 'missing-issuer' });
  });

  /**
   * Nothing should be minted for a launch that is not going to happen. This counted single-use
   * tokens until the launch record replaced them, after which it passed without proving
   * anything: no code has written a token of that purpose since.
   */
  it('mints nothing when it refuses', async () => {
    await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });

    await begin();

    expect(await prisma.ltiLaunchTransaction.count()).toBe(0);
  });
});
