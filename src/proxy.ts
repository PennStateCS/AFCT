import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isSessionIdleExpired } from '@/lib/session-timeout';
import { requireAuthSecret } from '@/lib/auth-secret';
// Next 16 runs Proxy on the Node.js runtime, so the database is reachable here. It is read
// once a minute at most, and only for the LTI routes.
import { prisma } from '@/lib/prisma';

/**
 * Coarse, edge-level authentication net.
 *
 * This is defense-in-depth, NOT the source of truth: every route and page still runs
 * its own authoritative check (route handlers use `withAdminAuth`/`withCourseAuth` or
 * call `auth()` + the permission helpers; the dashboard layout redirects
 * unauthenticated users). Here we only read the signed JWT (no DB, since this runs on
 * the edge) and reject early.
 *
 * Deny-by-default: the matcher covers ALL of `/api/*` and `/dashboard/*`, and only the
 * small, stable {@link PUBLIC_API_PREFIXES} allowlist is let through unauthenticated.
 * This means a newly added authed API route is gated automatically (fail-closed); the
 * matcher never needs editing when routes move or are added.
 *
 *  - Public API routes: bypass the net (no token read).
 *  - `/api/admin/*`: positively confirm a NON-admin out with 403. A missing or
 *    undecodable token falls through to the route's authoritative `isAdmin` check, so a
 *    decode hiccup can never lock admins out.
 *  - any other `/api/*`: require a signed-in session; no token -> 401. Per-course
 *    role/authorization still happens in the handler (the edge can't reach Prisma).
 *  - `/dashboard/*` pages: require a session; no token -> redirect to /login.
 */
const PUBLIC_API_PREFIXES = [
  '/api/auth', // NextAuth handler, signup, check-email
  '/api/health',
  '/api/system-settings/public',
  // Native (Java) client API: authenticated by its own bearer-token wrapper
  // (`withClientAuth`), not the browser session cookie. Bypassing the edge net here
  // is intentional: the cookie/idle-timeout logic doesn't apply to token clients,
  // and every /api/client route enforces its own token auth.
  '/api/client',
  // AFCT's public keyset, fetched by an LMS's servers, which have no AFCT session and never
  // will. Publishes only public keys.
  '/api/lti/jwks',
  // The launch round trip: the LMS sends the browser here, and posts the signed token back.
  // Nobody is signed in yet, which is the point of a launch. Both verify what they are handed.
  '/api/lti/login',
  '/api/lti/launch',
  // Where an administrator types their AFCT password to attach the LMS account a launch
  // matched. Necessarily unauthenticated, since it exists to establish who they are, and it
  // proves that itself through the same credential check the login form uses.
  '/api/lti/confirm-identity',
] as const;

/**
 * Whether NextAuth will have used the `__Secure-` cookie prefix, which it does whenever the
 * app's own URL is https, regardless of build type.
 */
function usesSecureCookies(): boolean {
  const url = process.env.NEXTAUTH_URL?.trim();
  if (url) return url.startsWith('https://');
  return process.env.NODE_ENV === 'production';
}

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Content-Security-Policy for a given per-request nonce. Built in one place so the
// request-header copy (which Next reads to stamp the nonce onto its own <script>
// tags) and the browser-facing response header are identical. Scripts are locked to
// 'self' + the per-request nonce + 'strict-dynamic' (Next's nonce'd loader pulls
// chunks, and the trust propagates to the hCaptcha script it injects) instead of the
// old 'unsafe-inline', so an injected inline script can't run. style-src keeps
// 'unsafe-inline' (React inline style={} and Next's injected styles need it; style
// XSS is low-risk). Dev keeps 'unsafe-eval' for React Fast Refresh.
function buildCsp(nonce: string, frameAncestors: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const hcaptcha = 'https://hcaptcha.com https://*.hcaptcha.com';
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `style-src 'self' 'unsafe-inline' ${hcaptcha}`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"} ${hcaptcha}`,
    `connect-src 'self' ${hcaptcha}`,
    `frame-src ${hcaptcha}`,
  ].join('; ');
}

// Enforce the policy in production; keep it Report-Only in development so Next's HMR
// and error-overlay inline scripts aren't blocked while you work. Set CSP_ENFORCE=false
// in production to fall back to Report-Only (e.g. to debug a violation without breaking
// the page); set CSP_ENFORCE=true in dev to preview enforcement.
const CSP_ENFORCE =
  process.env.CSP_ENFORCE === 'true' ||
  (process.env.NODE_ENV === 'production' && process.env.CSP_ENFORCE !== 'false');


/**
 * Which origins may put AFCT in an iframe.
 *
 * An LMS embeds its tools: Canvas's deep-linking picker is a modal iframe and offers no way to
 * open a new tab, so `frame-ancestors 'self'` makes deep linking impossible rather than merely
 * awkward. The answer is not to drop the protection but to name the platforms an administrator
 * has actually registered, and only on the LTI routes an LMS ever frames. Every other page on
 * the site stays unframeable.
 *
 * The issuer is deliberately not used here. A self-hosted Canvas reports the issuer
 * `https://canvas.instructure.com` while living at its own hostname, so the issuer would name an
 * origin that never sends a request. The three endpoint URLs are where the LMS really is.
 */
const FRAME_ANCESTOR_TTL_MS = 60_000;
let frameAncestorCache: { value: string; expires: number } | null = null;

function isLtiPath(pathname: string): boolean {
  return pathname === '/lti' || pathname.startsWith('/lti/') || pathname.startsWith('/api/lti');
}

async function ltiFrameAncestors(): Promise<string> {
  const now = Date.now();
  if (frameAncestorCache && frameAncestorCache.expires > now) return frameAncestorCache.value;

  let value = "'self'";
  try {
    const platforms = await prisma.ltiPlatform.findMany({
      select: { authLoginUrl: true, tokenUrl: true, keysetUrl: true },
    });
    const origins = new Set<string>();
    for (const platform of platforms) {
      for (const url of [platform.authLoginUrl, platform.tokenUrl, platform.keysetUrl]) {
        try {
          origins.add(new URL(url).origin);
        } catch {
          // A stored value that will not parse is a registration problem, not a reason to
          // refuse every launch. The route that uses it reports it properly.
        }
      }
    }
    if (origins.size > 0) value = `'self' ${[...origins].sort().join(' ')}`;
  } catch {
    // The database being unreachable must not decide the security policy. Falling back to
    // 'self' fails closed: deep linking stops working, nothing becomes frameable.
    return "'self'";
  }

  frameAncestorCache = { value, expires: now + FRAME_ANCESTOR_TTL_MS };
  return value;
}

/** Exported for tests, which need each case to start from a known cache. */
export function resetFrameAncestorCache(): void {
  frameAncestorCache = null;
}

// Generate a nonce, return the request headers Next reads it from plus a helper that
// stamps the browser-facing (enforced or report-only) header onto a response.
async function prepareCsp(req: NextRequest, pathname: string) {
  const nonce = btoa(crypto.randomUUID());
  // Only the LTI routes pay for the lookup; everything else keeps the strict default and
  // never touches the database.
  const csp = buildCsp(nonce, isLtiPath(pathname) ? await ltiFrameAncestors() : "'self'");
  const requestHeaders = new Headers(req.headers);
  // A request header is invisible to the browser (so it doesn't enforce anything);
  // Next uses it only to discover the nonce and apply it to its script tags.
  requestHeaders.set('content-security-policy', csp);
  requestHeaders.set('x-nonce', nonce);
  const responseHeader = CSP_ENFORCE
    ? 'content-security-policy'
    : 'content-security-policy-report-only';
  return {
    pass: () => {
      const res = NextResponse.next({ request: { headers: requestHeaders } });
      res.headers.set(responseHeader, csp);
      return res;
    },
    withCsp: (res: NextResponse) => {
      res.headers.set(responseHeader, csp);
      return res;
    },
  };
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const { pass, withCsp } = await prepareCsp(req, pathname);

  const isApi = pathname.startsWith('/api/');
  const isDashboard = pathname.startsWith('/dashboard');

  // Non-API, non-dashboard pages (/, /login, /change-password, ...) aren't gated by
  // the edge auth net; they only receive the CSP + nonce so the policy covers every
  // rendered page (the login page's hCaptcha included).
  if (!isApi && !isDashboard) {
    return pass();
  }

  // Public API routes bypass the net entirely (and skip the token read).
  if (isApi && isPublicApi(pathname)) {
    return pass();
  }

  const token = await getToken({
    req,
    secret: requireAuthSecret(),
    // NextAuth names the session cookie from the URL scheme, not from NODE_ENV: on https it
    // sets `__Secure-next-auth.session-token`. Keying this off NODE_ENV alone means any https
    // deployment that is not a production build looks signed out to the edge, and every API
    // call 401s while pages still work, because pages read the cookie server-side instead.
    secureCookie: usesSecureCookies(),
  });

  // Idle-timeout backstop: reject a signed-in token whose activity window has
  // lapsed, from the token alone (no DB; this runs on the edge). The client
  // watcher normally signs the user out gracefully first; this catches clients
  // that aren't running (locked, suspended, JS disabled, tampered). Sign-out and
  // the activity heartbeat go through `/api/auth/*`, which is allowlisted above,
  // so an expired session can still end itself.
  if (token && isSessionIdleExpired(token.lastActivity, token.idleTimeoutMs, Date.now())) {
    if (isApi) {
      return withCsp(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname + search);
    return withCsp(NextResponse.redirect(loginUrl));
  }

  // Admin namespace: only short-circuit when we can POSITIVELY confirm a non-admin.
  if (pathname.startsWith('/api/admin')) {
    if (token && token.isAdmin !== true) {
      return withCsp(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    }
    return pass();
  }

  // Everything else the matcher covers requires a signed-in session.
  if (!token) {
    if (isApi) {
      return withCsp(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }
    // Page route: bounce to login, remembering where they were headed.
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname + search);
    return withCsp(NextResponse.redirect(loginUrl));
  }

  return pass();
}

export const config = {
  // Run on every route so the CSP + nonce cover all pages, except Next's own static
  // assets, image optimizer, and the favicon (no HTML to protect there). The auth net
  // still only gates /api/* and /dashboard/* (keyed on the pathname above); other
  // matched paths just receive the CSP header.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
