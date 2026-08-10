import { afterEach, describe, expect, it } from 'vitest';
import { publicUrl } from './public-url';

/**
 * Building AFCT's own address.
 *
 * This is the bug that only appears once something sits in front of the app, which is every
 * real deployment: nginx in production, a tunnel in testing. The request's host is internal, so
 * a `redirect_uri` built from it is rejected by the platform and a browser redirect built from
 * it goes nowhere. A developer running the bare dev server never sees it.
 */

const original = process.env.NEXTAUTH_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = original;
});

// The internal address the app sees behind a proxy.
const request = new Request('http://localhost:3000/api/lti/login');

it('uses the configured public address, not the request host', () => {
  process.env.NEXTAUTH_URL = 'https://afct.example.edu';

  expect(publicUrl('/api/lti/launch', request)).toBe('https://afct.example.edu/api/lti/launch');
});

it('tolerates a trailing slash on the configured address', () => {
  process.env.NEXTAUTH_URL = 'https://afct.example.edu/';

  expect(publicUrl('/api/lti/launch', request)).toBe('https://afct.example.edu/api/lti/launch');
});

// A bare development server, where the two are the same anyway.
it('falls back to the request when nothing is configured', () => {
  delete process.env.NEXTAUTH_URL;

  expect(publicUrl('/api/lti/launch', request)).toBe('http://localhost:3000/api/lti/launch');
});

describe('the case this exists for', () => {
  it('does not leak an internal host into a URL the platform will compare', () => {
    process.env.NEXTAUTH_URL = 'https://afct.example.edu';

    expect(publicUrl('/api/lti/launch', request)).not.toContain('localhost');
  });
});
