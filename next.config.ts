import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Don’t fail production builds on ESLint issues; enforce via CI instead
  eslint: {
    ignoreDuringBuilds: true,
  },
  turbopack: {
    root: __dirname,
  },

  // Keep native/server-only deps external so they load from node_modules at
  // runtime instead of being bundled (bcrypt is a native addon). This is
  // bundler-agnostic — it applies under Turbopack too, unlike webpack externals.
  serverExternalPackages: ['bcrypt'],

  // Baseline security headers on every response. No CSP here — that needs
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
