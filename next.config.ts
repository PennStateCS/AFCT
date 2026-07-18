import type { NextConfig } from 'next';

// The Content-Security-Policy now lives in the middleware (src/proxy.ts) because it
// carries a per-request nonce (script-src 'nonce-…' 'strict-dynamic' instead of
// 'unsafe-inline'), which a static header here can't do. It ships Report-Only until
// CSP_ENFORCE=true. The static security headers below don't need a nonce, so they
// stay here.

const nextConfig: NextConfig = {
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
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          // The Content-Security-Policy is set per-request (with a nonce) in the
          // middleware, not here. HSTS is left to nginx (docker/nginx/default.conf),
          // which only sends it with a real cert to avoid trapping self-signed deploys.
        ],
      },
    ];
  },

  webpack: (config, { isServer, webpack }) => {
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
