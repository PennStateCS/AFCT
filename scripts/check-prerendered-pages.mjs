#!/usr/bin/env node
// Fails the build if any page is statically prerendered.
//
// AFCT sends a Content-Security-Policy with a per-request nonce (see `src/proxy.ts`), and Next
// stamps that nonce onto its script tags only while rendering per request. HTML generated at
// build time therefore carries no nonce, the browser blocks every script on the page, and the
// result is a page that loads and then does nothing: no error, no clue, just a blank screen.
//
// This is worth a build failure rather than a lint rule because it is invisible everywhere else.
// It broke `/lti/complete`, `/forgot-password` and `/reset-password` in production at once, and
// nothing caught it: jsdom does not enforce CSP, so every unit test passed.
//
// If a page genuinely needs to be static one day, the honest fix is to stop sending a nonce for
// it, not to delete this check.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const BUILD_DIR = process.env.NEXT_BUILD_DIR ?? '.next';

/** Route handlers ship no scripts, so a nonce is irrelevant to them. */
const ALLOWED = new Set([
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
  // Next's global error boundary replaces the root layout, so it cannot inherit the layout's
  // `dynamic` setting and there is nowhere else to put one: it is a client component, where
  // route segment config is ignored. Its prerendered HTML still carries the message, but its
  // "try again" button will not work under the nonce policy. Accepted because it only appears
  // when the app has already failed, and a reload does the same job.
  '/_global-error',
]);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const manifest = await readJson(path.join(BUILD_DIR, 'prerender-manifest.json'));
if (!manifest) {
  console.error(
    `check-prerendered-pages: no ${BUILD_DIR}/prerender-manifest.json. Run this after "next build".`,
  );
  process.exit(1);
}

const appRoutes = await readJson(path.join(BUILD_DIR, 'app-path-routes-manifest.json'));
const pagePaths = new Set(
  Object.entries(appRoutes ?? {})
    // A page's entry ends in /page; anything else is a route handler or a layout.
    .filter(([source]) => source.endsWith('/page'))
    .map(([, route]) => route),
);

const offenders = Object.keys(manifest.routes ?? {})
  .filter((route) => !ALLOWED.has(route))
  // When the app-path manifest is unavailable, fall back to flagging everything: a false alarm
  // is cheap, and silence is what this check exists to prevent.
  .filter((route) => pagePaths.size === 0 || pagePaths.has(route));

if (offenders.length > 0) {
  console.error('\ncheck-prerendered-pages: these pages are statically prerendered:\n');
  for (const route of offenders) console.error(`  ${route}`);
  console.error(
    '\nEvery script on them will be blocked by the nonce in our Content-Security-Policy, so they\n' +
      'will render blank in a browser while passing every test. Add this to each page:\n\n' +
      "  export const dynamic = 'force-dynamic';\n",
  );
  process.exit(1);
}

console.log(`check-prerendered-pages: no prerendered pages (${pagePaths.size} pages checked).`);
