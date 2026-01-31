import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Fix for CommonJS modules in ESM context (only jsonwebtoken since bcrypt is external)
  transpilePackages: ['jsonwebtoken'],

  // Temporarily skip type-checking during build to avoid TS stack overflow
  typescript: {
    ignoreBuildErrors: true,
  },

  // Mark external packages that shouldn't be bundled
  serverExternalPackages: ['@prisma/client', 'bcrypt', '@mapbox/node-pre-gyp'],

  // Turbopack config (required when using webpack config)
  turbopack: {
    root: __dirname,
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

    // Handle CommonJS modules that break in ESM context
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        jsonwebtoken: 'commonjs jsonwebtoken',
        bcrypt: 'commonjs bcrypt',
        crypto: 'commonjs crypto',
      });
    }

    // Prevent watchpack from scanning Docker volume mounts with restricted perms
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: [
        '**/dev-postgres/**',
        '**/dev-postgres',
        '**/dev-postgres/**/*',
        '/app/dev-postgres/**',
        '/app/dev-postgres/**/*',
        '**/dev-uploads/**',
        '**/dev-uploads',
        '**/dev-uploads/**/*',
        '/app/dev-uploads/**',
        '/app/dev-uploads/**/*',
      ],
    };

    return config;
  },
};

export default nextConfig;
