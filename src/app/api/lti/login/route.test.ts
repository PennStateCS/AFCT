import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The launch entry point.
 *
 * The cookie attributes are the interesting part. A launch happens inside an LMS frame, on a
 * different site, so a cookie without `SameSite=None` is simply never sent back and every launch
 * fails with nothing to see. These assertions exist because that failure is invisible in jsdom,
 * in unit tests, and in any environment that is not a real browser inside a real LMS.
 */

const beginLaunch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/lti/login-init', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lti/login-init')>()),
  beginLaunch,
}));

const { GET, POST } = await import('./route');

const REDIRECT = 'https://canvas.example.test/api/lti/authorize_redirect?state=s';

beforeEach(() => {
  vi.clearAllMocks();
  beginLaunch.mockResolvedValue({ ok: true, redirectUrl: REDIRECT, state: 'state-value' });
});

const get = (query: string) => GET(new Request(`https://afct.example.test/api/lti/login?${query}`));

const post = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return POST(new Request('https://afct.example.test/api/lti/login', { method: 'POST', body }));
};

describe('starting a launch', () => {
  // Platforms differ, and the spec permits both. Canvas posts; the reference implementation gets.
  it('accepts the parameters as a query string', async () => {
    const res = await get('iss=https%3A%2F%2Fcanvas.example.test&login_hint=user-1');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(REDIRECT);
    expect(beginLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ iss: 'https://canvas.example.test', login_hint: 'user-1' }),
      }),
    );
  });

  it('accepts them as a form post', async () => {
    const res = await post({ iss: 'https://canvas.example.test', login_hint: 'user-1' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(REDIRECT);
  });

  /**
   * The redirect back must match what is registered in the LMS exactly, as a string. Platforms
   * compare it literally and refuse a mismatch, reporting it in ways that rarely name the cause.
   */
  it('tells the platform to come back to this instance', async () => {
    await get('iss=https%3A%2F%2Fcanvas.example.test');

    expect(beginLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: 'https://afct.example.test/api/lti/launch' }),
    );
  });
});

describe('the state cookie', () => {
  it('is set so it survives the round trip through the LMS', async () => {
    const res = await get('iss=https%3A%2F%2Fcanvas.example.test');
    const cookie = res.headers.get('set-cookie') ?? '';

    // Anything stricter than None and the cookie is not sent back at all.
    expect(cookie).toMatch(/SameSite=none/i);
    expect(cookie).toMatch(/Secure/i);
    // Third-party by definition, so CHIPS is what keeps it from being dropped.
    expect(cookie).toMatch(/Partitioned/i);
  });

  it('is not readable by scripts', async () => {
    const res = await get('iss=https%3A%2F%2Fcanvas.example.test');

    expect(res.headers.get('set-cookie') ?? '').toMatch(/HttpOnly/i);
  });

  it('carries the state that was minted', async () => {
    const res = await get('iss=https%3A%2F%2Fcanvas.example.test');

    expect(res.headers.get('set-cookie') ?? '').toContain('state-value');
  });
});

describe('when the launch cannot be started', () => {
  it('says so in words, because a person is reading it inside an LMS frame', async () => {
    beginLaunch.mockResolvedValue({ ok: false, reason: 'unregistered-platform' });

    const res = await get('iss=https%3A%2F%2Funknown.example.test');

    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(await res.text()).toContain('not registered');
  });

  it('sets no cookie for a launch that is not happening', async () => {
    beginLaunch.mockResolvedValue({ ok: false, reason: 'unregistered-platform' });

    const res = await get('iss=https%3A%2F%2Funknown.example.test');

    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('distinguishes a malformed request from an unknown LMS', async () => {
    beginLaunch.mockResolvedValue({ ok: false, reason: 'missing-issuer' });

    expect((await get('')).status).toBe(400);
  });
});
