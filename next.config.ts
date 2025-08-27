import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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

    return config;
  },
};

export default nextConfig;
