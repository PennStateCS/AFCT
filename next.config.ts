import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Don’t fail production builds on ESLint issues; enforce via CI instead
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Fix for CommonJS modules in ESM context
  transpilePackages: ['jsonwebtoken', 'bcrypt'],
  
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
      })
    );

    // Handle CommonJS modules that break in ESM context
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'jsonwebtoken': 'commonjs jsonwebtoken',
        'bcrypt': 'commonjs bcrypt',
        'crypto': 'commonjs crypto',
      });
    }

    // Prevent watchpack from scanning Docker volume mounts with restricted perms
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: [
        '**/dev-postgres/**',
        '**/dev-uploads/**',
      ],
    };

    return config;
  },
};

export default nextConfig;
