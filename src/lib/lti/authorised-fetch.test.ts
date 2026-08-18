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
  samePageOrigin,
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

/** Answers with whatever status the path asks for, so every redirect code can be exercised. */
const statusRedirector = http.createServer((req, res) => {
  const status = Number((req.url ?? '/').replace('/', '')) || 302;
  res.writeHead(status, {
    Location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/moved`,
  });
  res.end();
});

/** Accepts the connection and never answers, for the timeout. */
const silent = http.createServer(() => {});

await new Promise<void>((resolve) => target.listen(0, resolve));
await new Promise<void>((resolve) => redirector.listen(0, resolve));
await new Promise<void>((resolve) => statusRedirector.listen(0, resolve));
await new Promise<void>((resolve) => silent.listen(0, resolve));
const targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}/x`;
const redirectUrl = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}/x`;

const statusRedirectUrl = (status: number) =>
  `http://127.0.0.1:${(statusRedirector.address() as AddressInfo).port}/${status}`;
const silentUrl = `http://127.0.0.1:${(silent.address() as AddressInfo).port}/x`;

afterAll(() => {
  target.close();
  redirector.close();
  statusRedirector.close();
  silent.close();
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

/**
 * This helper is now the one door AGS, NRPS and the token request all go through, so its
 * behaviour is a security property of all three rather than a convenience of one. These lock it
 * down against a future caller quietly inheriting something weaker.
 */
describe('the guarantees every caller inherits', () => {
  it.each([301, 302, 303, 307, 308])('refuses %i rather than following it', async (status) => {
    const result = await authorisedFetch(statusRedirectUrl(status), {
      headers: { Authorization: 'Bearer secret-token' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('redirected');
    // 307 and 308 are the dangerous pair: they resend the body, so a POST carrying a signed
    // client assertion would deliver it to the new host intact.
    expect(result.failure.kind === 'redirected' && result.failure.to).toContain('/moved');
  });

  it('never lets the credential reach the redirect target', async () => {
    let sawRequest = false;
    const listener = http.createServer((req, res) => {
      sawRequest = true;
      res.end(JSON.stringify({ authorization: req.headers.authorization ?? null }));
    });
    await new Promise<void>((resolve) => listener.listen(0, resolve));
    const port = (listener.address() as AddressInfo).port;
    const sender = http.createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/collect` });
      res.end();
    });
    await new Promise<void>((resolve) => sender.listen(0, resolve));

    await authorisedFetch(`http://127.0.0.1:${(sender.address() as AddressInfo).port}/x`, {
      headers: { Authorization: 'Bearer secret-token' },
    });

    // The whole point: not "the header was stripped" but "the request never happened".
    expect(sawRequest).toBe(false);
    listener.close();
    sender.close();
  });

  it('refuses a redirect even back to the same origin', async () => {
    // Deliberately not special-cased. A same-origin redirect is harmless in itself, but the
    // rule stays simple enough that nobody has to reason about which redirects are safe.
    const sameOrigin = http.createServer((req, res) => {
      if ((req.url ?? '') === '/moved') return res.end('{}');
      res.writeHead(302, { Location: '/moved' });
      res.end();
    });
    await new Promise<void>((resolve) => sameOrigin.listen(0, resolve));

    const result = await authorisedFetch(
      `http://127.0.0.1:${(sameOrigin.address() as AddressInfo).port}/x`,
      { headers: { Authorization: 'Bearer secret-token' } },
    );

    expect(result.ok).toBe(false);
    sameOrigin.close();
  });

  it('gives up on a platform that never answers', async () => {
    const result = await authorisedFetch(silentUrl, {
      headers: { Authorization: 'Bearer secret-token' },
      timeoutMs: 100,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Told apart from a refused connection: one is a platform that is up and stalling, the
    // other is one that is not there, and different people fix them.
    expect(result.failure.kind).toBe('timeout');
    expect(authorisedFetchFailureDetail(result.failure)).toContain('did not answer');
  });

  it('reports an address that is not a URL rather than throwing', async () => {
    const result = await authorisedFetch('not a url', { headers: {} });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('network');
  });

  it('passes a 4xx back to the caller instead of treating it as a failure', async () => {
    // A platform saying no is an answer, and the caller reads its body to say what to fix.
    const refusing = http.createServer((_req, res) => {
      res.writeHead(403);
      res.end('not installed in this course');
    });
    await new Promise<void>((resolve) => refusing.listen(0, resolve));

    const result = await authorisedFetch(
      `http://127.0.0.1:${(refusing.address() as AddressInfo).port}/x`,
      { headers: {} },
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.response.status).toBe(403);
    refusing.close();
  });
});

/**
 * Where a paged read is allowed to go next. AGS and NRPS both take the address from a header the
 * platform writes, and both carry a bearer token while doing it.
 */
describe('which next page may be followed', () => {
  const origin = 'https://lms.example.test';

  it('follows a page on the origin the read started from', () => {
    expect(samePageOrigin(`${origin}/memberships?page=2`, origin)).toBe(
      `${origin}/memberships?page=2`,
    );
  });

  it.each([
    ['another host', 'https://evil.example/collect'],
    ['another port', 'https://lms.example.test:8443/page2'],
    ['another scheme', 'http://lms.example.test/page2'],
    ['a scheme that is not http at all', 'javascript:alert(1)'],
    ['something that is not a URL', 'page2'],
  ])('refuses %s', (_label, candidate) => {
    expect(samePageOrigin(candidate, origin)).toBeNull();
  });
});
