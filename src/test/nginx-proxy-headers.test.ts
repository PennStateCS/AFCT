import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The shipped nginx configuration, for the one property no other test can see.
 *
 * Starting an institutional sign-in answers with a redirect to the identity provider plus the
 * cookies that secure it: state (an encrypted JWE of several hundred bytes), PKCE, nonce, CSRF
 * and the callback URL, with the whole authorization request in `Location`. That header block
 * runs past nginx's default 4k buffer, and nginx answers 502 rather than forwarding a response
 * whose headers do not fit. On prod the button simply did nothing, and nothing in the
 * application could tell: the response it produced was correct, and the app never saw the 502.
 *
 * Asserting on the file because the failure lives between the app and the browser, where no
 * unit or database test reaches.
 */

const config = readFileSync(
  path.join(process.cwd(), 'docker/nginx/default.conf'),
  'utf8',
);

/** The value of a directive, in kilobytes, from the app's `location /` block. */
function sizeOf(directive: string): number {
  const match = new RegExp(`${directive}\\s+(?:\\d+\\s+)?(\\d+)k;`).exec(config);
  expect(match, `${directive} is not set in the nginx config`).not.toBeNull();
  return Number(match![1]);
}

describe('room for the response headers an OIDC redirect carries', () => {
  it('gives the header buffer more than nginx\'s 4k default', () => {
    // 16k is the smallest that fits the redirect with room to spare.
    expect(sizeOf('proxy_buffer_size')).toBeGreaterThanOrEqual(16);
  });

  it('keeps the body buffers at least as large, which nginx requires', () => {
    expect(sizeOf('proxy_buffers')).toBeGreaterThanOrEqual(sizeOf('proxy_buffer_size'));
    expect(sizeOf('proxy_busy_buffers_size')).toBeGreaterThanOrEqual(sizeOf('proxy_buffer_size'));
  });
});
