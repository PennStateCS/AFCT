import type { NextConfig } from 'next';

// Content-Security-Policy, shipped in REPORT-ONLY mode first: browsers report
// violations (to the console) without blocking, so we can observe and tune the
// policy against the real app before switching the header key to the enforcing
// `Content-Security-Policy`. hCaptcha's script/frame/style/connect origins are
// allowlisted so the policy already works once enforced. Dev needs 'unsafe-eval'
// for React Fast Refresh; production drops it. ('unsafe-inline' on script/style
// is still required until Next.js nonce-based CSP is wired up (tighten later).)
const isProd = process.env.NODE_ENV === 'production';
const HCAPTCHA = 'https://hcaptcha.com https://*.hcaptcha.com';
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `style-src 'self' 'unsafe-inline' ${HCAPTCHA}`,
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"} ${HCAPTCHA}`,
  `connect-src 'self' ${HCAPTCHA}`,
  `frame-src ${HCAPTCHA}`,
].join('; ');

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
          // Report-only for now (see the note above). HSTS is intentionally left
          // to nginx (docker/nginx/default.conf), which only sends it with a real
          // cert to avoid trapping self-signed deployments.
          { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
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
