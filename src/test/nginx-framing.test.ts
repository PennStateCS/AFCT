import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Who is allowed to say how AFCT may be framed.
 *
 * The answer has to be exactly one place, and it is the app (`src/proxy.ts`), which allows the
 * LMS platforms an administrator has registered. Browsers apply every Content-Security-Policy
 * header on a response and enforce the intersection, so a second header from nginx saying
 * `frame-ancestors 'self'` silently overrules the app no matter how permissive the app's policy
 * is. X-Frame-Options is worse again: it cannot express an allowlist, only SAMEORIGIN or DENY.
 *
 * That combination made LTI deep linking impossible, and did it invisibly: Canvas's picker is an
 * iframe, so it simply drew a blank box with no error anywhere. This test exists because the
 * failure has no other symptom, and because re-adding a security header to nginx looks like an
 * improvement in review.
 *
 * It reads the shipped config as text rather than running nginx, so it proves what we ship
 * rather than what a container does with it. The behaviour itself was verified by running this
 * config under nginx and reading the response headers.
 */

const CONFIG = readFileSync(
  path.join(process.cwd(), 'docker', 'nginx', 'default.conf'),
  'utf8',
);

/**
 * The body of a `location <prefix>` block, brace-matched from the config text.
 *
 * `from` matters: there are two `location /` blocks, and the first belongs to the http-to-https
 * redirect server, which proxies nothing and sets no headers. Matching that one instead of the
 * app's would make this whole file pass while proving nothing, which is how the first draft of
 * this test behaved.
 */
function locationBlock(prefix: string, from = 0): string {
  const start = CONFIG.indexOf(`location ${prefix} {`, from);
  expect(start, `no "location ${prefix}" block in docker/nginx/default.conf`).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = CONFIG.indexOf('{', start); i < CONFIG.length; i++) {
    if (CONFIG[i] === '{') depth += 1;
    if (CONFIG[i] === '}') {
      depth -= 1;
      if (depth === 0) return CONFIG.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated "location ${prefix}" block`);
}

/** The `location /` that forwards to Next.js, found by the proxy_pass inside it. */
const APP_LOCATION_AT = CONFIG.lastIndexOf(
  'location / {',
  CONFIG.indexOf('proxy_pass http://app_upstream'),
);

/** Directives only, so the explanatory comments do not read as configuration. */
function directives(block: string): string {
  return block
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

describe('nginx framing headers', () => {
  it('leaves the app pages to set their own framing policy', () => {
    const app = directives(locationBlock('/', APP_LOCATION_AT));

    expect(app).not.toMatch(/add_header\s+Content-Security-Policy/i);
    expect(app).not.toMatch(/add_header\s+X-Frame-Options/i);
  });

  it('still sends the other baseline headers on app pages', () => {
    // Declaring any add_header in a location drops every inherited one, so the headers worth
    // keeping have to be repeated. Losing them is the easy mistake in this change.
    const app = directives(locationBlock('/', APP_LOCATION_AT));

    expect(app).toMatch(/add_header\s+X-Content-Type-Options\s+"nosniff"/i);
    expect(app).toMatch(/add_header\s+Referrer-Policy/i);
    expect(app).toMatch(/add_header\s+Permissions-Policy/i);
  });

  it('keeps uploaded files unframeable, whatever the app allows', () => {
    // Student work served from disk is not an LTI surface and no LMS needs to embed it.
    const uploads = directives(locationBlock('/uploads/'));

    expect(uploads).toMatch(/add_header\s+Content-Security-Policy\s+"frame-ancestors 'self'"/i);
    expect(uploads).toMatch(/add_header\s+X-Frame-Options\s+"SAMEORIGIN"/i);
  });
});
