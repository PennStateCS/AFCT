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
  await prisma.singleUseToken.deleteMany({
    where: { purpose: { in: ['LTI_LAUNCH_NONCE', 'LTI_LAUNCH_STATE'] } },
  });
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

const begin = (params: Record<string, string> = {}) =>
  beginLaunch({
    params: { iss: ISSUER, login_hint: 'lms-user-1', ...params },
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

  it('records them so they can be spent exactly once', async () => {
    await begin();

    expect(await prisma.singleUseToken.count({ where: { purpose: 'LTI_LAUNCH_STATE' } })).toBe(1);
    expect(await prisma.singleUseToken.count({ where: { purpose: 'LTI_LAUNCH_NONCE' } })).toBe(1);
  });

  it('gives every launch its own pair', async () => {
    const first = await begin();
    const second = await begin();

    expect(first.ok && second.ok && first.state).not.toBe(second.ok && second.state);
  });

  // Short on purpose: this covers one redirect out and back, not a sign-in session.
  it('expires them within minutes, not hours', async () => {
    await begin();

    const token = await prisma.singleUseToken.findFirstOrThrow({
      where: { purpose: 'LTI_LAUNCH_STATE' },
    });
    const lifetime = token.expiresAt.getTime() - token.createdAt.getTime();
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

  it('refuses a request that does not say where it came from', async () => {
    const result = await beginLaunch({ params: { iss: null }, redirectUri: REDIRECT });

    expect(result).toEqual({ ok: false, reason: 'missing-issuer' });
  });

  // Nothing should be minted for a launch that is not going to happen.
  it('mints nothing when it refuses', async () => {
    await prisma.ltiPlatform.deleteMany({ where: { issuer: ISSUER } });

    await begin();

    expect(await prisma.singleUseToken.count({ where: { purpose: 'LTI_LAUNCH_STATE' } })).toBe(0);
  });
});
