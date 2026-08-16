import type { NextConfig } from 'next';

// The Content-Security-Policy now lives in the middleware (src/proxy.ts) because it
// carries a per-request nonce (script-src 'nonce-…' 'strict-dynamic' instead of
// 'unsafe-inline'), which a static header here can't do. It ships Report-Only until
// CSP_ENFORCE=true. The static security headers below don't need a nonce, so they
// stay here.

/**
 * Hosts allowed to reach the dev server from an origin other than localhost.
 *
 * Next refuses dev requests, including the hot-reload WebSocket, from an origin it does not
 * recognise: the upgrade is answered with `Unauthorized`, the client retries for ever, and the
 * page reloads itself trying to recover. That breaks any flow with a redirect in it.
 *
 * Only relevant when the dev server is reached through something else, which today means the
 * tunnel used for LTI testing. Read from the environment rather than hard-coded, because a
 * quick tunnel gets a new hostname every time it starts.
 */
const devOrigins = (process.env.AFCT_DEV_ORIGINS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(devOrigins.length ? { allowedDevOrigins: devOrigins } : {}),
  // Next 16 no longer runs ESLint during `next build` (lint is enforced via the
  // `lint` script / CI), so the old `eslint.ignoreDuringBuilds` key is gone.
  turbopack: {
    root: __dirname,
  },

  // Turbopack's polling knob, gated on the env the dev compose file sets. Note:
  // this alone proved insufficient over the Windows bind mount (mtime propagated
  // but invalidation never fired), which is why dev-in-Docker runs webpack (see
  // docker-compose.dev.yml). Kept because it's the documented Turbopack fallback
  // and harmless elsewhere.
  ...(process.env.CHOKIDAR_USEPOLLING === 'true' ? { watchOptions: { pollIntervalMs: 500 } } : {}),

  // Keep native/server-only deps external so they load from node_modules at
  // runtime instead of being bundled (bcrypt is a native addon). This is
  // bundler-agnostic; it applies under Turbopack too, unlike webpack externals.
  serverExternalPackages: ['bcrypt', 'acme-client'],

  // Baseline security headers on every response. No CSP here; that needs
  // app-specific tuning; these are safe defense-in-depth defaults.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // No X-Frame-Options. `frame-ancestors` in the per-request CSP (src/proxy.ts) says
          // the same thing and says it better: X-Frame-Options can only express SAMEORIGIN or
          // DENY, so it cannot allow the LMS platforms an administrator has registered, and
          // sending both means the cruder header decides. Every page gets a CSP with
          // frame-ancestors, defaulting to 'self', so nothing is framed that was not before.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          // Nothing in a private course tool should be indexed. src/app/robots.ts
          // asks crawlers not to fetch; this header is the part that actually binds,
          // since it also covers URLs a crawler reaches via an inbound link and
          // non-HTML responses that can't carry a <meta name="robots">.
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate',
          },
          // The Content-Security-Policy is set per-request (with a nonce) in the
          // middleware, not here. HSTS is left to nginx (docker/nginx/default.conf),
          // which only sends it with a real cert to avoid trapping self-signed deploys.
        ],
      },
    ];
  },

  webpack: (config, { isServer, webpack }) => {
    // Don't watch trees the app is never built from.
    //
    // Dev in Docker polls for changes, because file events don't cross the Windows bind
    // mount. Polling means every watched path is stat'ed on an interval, and over that
    // mount each stat is a round trip to the host: walking the repo from inside the
    // container measured 46 files per second, against roughly 350,000 on a container
    // volume. The repo carries 77k files, of which the app owns about 900, so almost all
    // of that polling was spent on the docs site, git objects, and deploy scripts. The
    // compose file hides the biggest offenders from the container; this covers the rest,
    // and applies to anyone running dev outside Docker too.
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        '**/.git/**',
        '**/node_modules/**',
        '**/.next/**',
        '**/docs-site/**',
        // Playwright writes failure artifacts while its webServer (next dev) is running.
        // Unignored, the first failing spec triggers a Fast Refresh that remounts every
        // component mid-test and cascades into unrelated failures.
        '**/test-results/**',
        '**/e2e-report/**',
      ],
    };

    // Fix CommonJS/ESM module issues
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };

    // Fix the 'self is not defined' error for server-side rendering
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.DefinePlugin({
        'typeof self': JSON.stringify(isServer ? 'undefined' : 'object'),
      }),
    );

    // crypto is a Node built-in; keep it external on the server. (bcrypt is
    // handled by serverExternalPackages above.)
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        crypto: 'commonjs crypto',
      });
    }

    return config;
  },
};

export default nextConfig;
