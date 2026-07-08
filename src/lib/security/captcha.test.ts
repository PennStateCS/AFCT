import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const secretMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/hcaptcha', () => ({ getHcaptchaSecretKey: secretMock }));

import { verifyCaptchaToken } from './captcha';

const fetchMock = vi.fn();
const okResponse = (success: boolean) => ({ ok: true, json: async () => ({ success }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  // The catch branch logs; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyCaptchaToken', () => {
  it('returns false and never calls hCaptcha when no secret is configured', async () => {
    secretMock.mockResolvedValue(null);

    expect(await verifyCaptchaToken('token', '1.2.3.4')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false and never calls hCaptcha when no token is provided', async () => {
    secretMock.mockResolvedValue('secret');

    expect(await verifyCaptchaToken(null, null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns true when hCaptcha reports success', async () => {
    secretMock.mockResolvedValue('secret');
    fetchMock.mockResolvedValue(okResponse(true));

    expect(await verifyCaptchaToken('token')).toBe(true);
  });

  it('returns false when hCaptcha reports failure', async () => {
    secretMock.mockResolvedValue('secret');
    fetchMock.mockResolvedValue(okResponse(false));

    expect(await verifyCaptchaToken('token')).toBe(false);
  });

  it('returns false on a non-OK HTTP response', async () => {
    secretMock.mockResolvedValue('secret');
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ success: true }) });

    expect(await verifyCaptchaToken('token')).toBe(false);
  });

  it('returns false when the request throws', async () => {
    secretMock.mockResolvedValue('secret');
    fetchMock.mockRejectedValue(new Error('network down'));

    expect(await verifyCaptchaToken('token')).toBe(false);
  });

  it('sends the secret, token, and remote IP to hCaptcha', async () => {
    secretMock.mockResolvedValue('the-secret');
    fetchMock.mockResolvedValue(okResponse(true));

    await verifyCaptchaToken('the-token', '9.9.9.9');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hcaptcha.com/siteverify');
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('the-secret');
    expect(body.get('response')).toBe('the-token');
    expect(body.get('remoteip')).toBe('9.9.9.9');
  });

  it('omits remoteip when no IP is given', async () => {
    secretMock.mockResolvedValue('the-secret');
    fetchMock.mockResolvedValue(okResponse(true));

    await verifyCaptchaToken('the-token');

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.has('remoteip')).toBe(false);
  });
});
