/**
 * Calling an LMS service without losing the token on the way.
 *
 * This is the fault that cost an evening of Canvas testing. Canvas advertised its gradebook
 * service as `http://` while serving `https://`, the proxy answered 301, and `fetch` dropped the
 * `Authorization` header because a change of scheme is a change of origin. Canvas then answered
 * 401, which reads as a permissions problem and sends an administrator through LMS permission
 * screens that are already correct.
 *
 * The first test is the whole thing in miniature, against real servers rather than a mock: it is
 * the behaviour of `fetch` that matters here, and a mocked `fetch` would prove nothing about it.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, describe, expect, it } from 'vitest';
import {
  authorisedFetch,
  authorisedFetchFailureDetail,
  preferPlatformScheme,
} from './authorised-fetch';

/** Records what the Authorization header looked like by the time the request arrived. */
const target = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ authorization: req.headers.authorization ?? null }));
});
const redirector = http.createServer((_req, res) => {
  res.writeHead(301, { Location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/x` });
  res.end();
});

await new Promise<void>((resolve) => target.listen(0, resolve));
await new Promise<void>((resolve) => redirector.listen(0, resolve));
const targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/x`;
const redirectUrl = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}/x`;

afterAll(() => {
  target.close();
  redirector.close();
});

describe('the redirect that eats credentials', () => {
  it('is what plain fetch does, which is why this exists', async () => {
    // Not testing our code: establishing the premise. A different port is a different origin,
    // exactly as http -> https is.
    const followed = await fetch(redirectUrl, { headers: { Authorization: 'Bearer t' } });

    expect(await followed.json()).toEqual({ authorization: null });
  });

  it('is refused rather than followed, and named', async () => {
    const result = await authorisedFetch(redirectUrl, { headers: { Authorization: 'Bearer t' } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('redirected');
    // Both addresses, because the difference between them is the diagnosis.
    expect(authorisedFetchFailureDetail(result.failure)).toContain(redirectUrl);
    expect(authorisedFetchFailureDetail(result.failure)).toContain(targetUrl);
    expect(authorisedFetchFailureDetail(result.failure)).toMatch(/http:\/\/ where it should be/);
  });

  it('carries the token when nothing redirects', async () => {
    const result = await authorisedFetch(targetUrl, { headers: { Authorization: 'Bearer t' } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await result.response.json()).toEqual({ authorization: 'Bearer t' });
  });

  it('reports a host that is not there as a network failure, not a redirect', async () => {
    const result = await authorisedFetch('http://127.0.0.1:1/x', {
      headers: { Authorization: 'x' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('network');
  });
});

describe('repairing the advertised scheme', () => {
  const token = 'https://canvas.example.test/login/oauth2/token';

  it('raises http to https when the platform proved it speaks TLS on that host', () => {
    expect(preferPlatformScheme('http://canvas.example.test/api/lti/line_items', token)).toBe(
      'https://canvas.example.test/api/lti/line_items',
    );
  });

  it('leaves a different host alone', () => {
    // A platform may legitimately hand out a service on another host, and rewriting somebody
    // else's address on a hunch is not something to do.
    const other = 'http://grades.elsewhere.test/api/line_items';
    expect(preferPlatformScheme(other, token)).toBe(other);
  });

  it('never downgrades', () => {
    const secure = 'https://canvas.example.test/api/lti/line_items';
    expect(preferPlatformScheme(secure, 'http://canvas.example.test/login/oauth2/token')).toBe(
      secure,
    );
  });

  it('leaves http alone when the platform itself is only http', () => {
    // Nothing has proved TLS works there, so assuming it would break a plain-http deployment.
    const plain = 'http://canvas.example.test/api/lti/line_items';
    expect(preferPlatformScheme(plain, 'http://canvas.example.test/login/oauth2/token')).toBe(
      plain,
    );
  });

  it('hands back anything it cannot parse, rather than guessing', () => {
    expect(preferPlatformScheme('not a url', token)).toBe('not a url');
  });
});
