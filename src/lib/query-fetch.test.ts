import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, fetchJson, retryUnlessClientError } from './query-fetch';

afterEach(() => {
  vi.restoreAllMocks();
});

const mockFetch = (impl: () => Response | Promise<Response>) => {
  vi.stubGlobal('fetch', vi.fn(impl));
};

describe('fetchJson', () => {
  it('returns parsed JSON on a 2xx response', async () => {
    mockFetch(() => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await expect(fetchJson<{ ok: number }>('/x')).resolves.toEqual({ ok: 1 });
  });

  it('throws HttpError carrying the status and server error message', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
    await expect(fetchJson('/x')).rejects.toMatchObject({
      name: 'HttpError',
      status: 403,
      message: 'Forbidden',
    });
  });

  it('falls back to a status message when the error body is not JSON', async () => {
    mockFetch(() => new Response('nope', { status: 500 }));
    const err = (await fetchJson('/x').catch((e) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(500);
    expect(err.message).toContain('500');
  });
});

describe('retryUnlessClientError', () => {
  it('never retries a 4xx HttpError', () => {
    expect(retryUnlessClientError(0, new HttpError(404, 'nope'))).toBe(false);
    expect(retryUnlessClientError(0, new HttpError(401, 'nope'))).toBe(false);
  });

  it('retries a 5xx HttpError once', () => {
    expect(retryUnlessClientError(0, new HttpError(500, 'boom'))).toBe(true);
    expect(retryUnlessClientError(1, new HttpError(500, 'boom'))).toBe(false);
  });

  it('retries an unknown error (no status) once', () => {
    expect(retryUnlessClientError(0, new Error('network'))).toBe(true);
    expect(retryUnlessClientError(1, new Error('network'))).toBe(false);
  });
});
