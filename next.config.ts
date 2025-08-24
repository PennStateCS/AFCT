import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Package optimization works with both webpack and turbopack
    optimizePackageImports: [
      '@radix-ui/react-icons', 
      'lucide-react',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@tanstack/react-table'
    ],
    
    // Turbopack-specific optimizations (only when turbopack is enabled)
    ...(process.env.TURBOPACK && {
      turbo: {
        // Turbopack-specific rules if needed
        rules: {},
      },
    }),
  },
  
  // Webpack optimizations (only apply when NOT using turbopack)
  ...(!process.env.TURBOPACK && process.env.NODE_ENV === 'development' && {
    webpack: (config, { dev }) => {
      if (dev) {
        // Better chunk splitting for faster compilation
        config.optimization = {
          ...config.optimization,
          splitChunks: {
            chunks: 'all',
            minSize: 20000,
            maxSize: 244000,
            cacheGroups: {
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: 'vendors',
                chunks: 'all',
                priority: 10,
              },
              common: {
                minChunks: 2,
                chunks: 'all',
                priority: 5,
                reuseExistingChunk: true,
              },
            },
          },
        };

        // Reduce file system checks
        config.watchOptions = {
          poll: false,
          ignored: [
            '**/node_modules',
            '**/.git',
            '**/.next',
            '**/dist',
            '**/coverage',
          ],
        };

        // Enable persistent caching
        config.cache = {
          type: 'filesystem',
          buildDependencies: {
            config: [__filename],
          },
        };
      }
      
      return config;
    },
  }),
};

export default nextConfig;
