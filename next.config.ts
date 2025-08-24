import type { NextConfig } from 'next';
import path from 'path';

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
  
  // Fix for CommonJS modules in ESM context
  transpilePackages: ['jsonwebtoken', 'bcrypt'],
  
  // Webpack optimizations (only apply when NOT using turbopack)
  ...(!process.env.TURBOPACK && {
    webpack: (config, { dev, isServer }) => {
      // Fix CommonJS/ESM module issues
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };

      // Handle CommonJS modules that break in ESM context
      config.externals = config.externals || [];
      if (isServer) {
        config.externals.push({
          'jsonwebtoken': 'commonjs jsonwebtoken',
          'bcrypt': 'commonjs bcrypt',
          'crypto': 'commonjs crypto',
        });
      }

      // Ensure proper module handling
      config.module.rules.push({
        test: /\.m?js$/,
        resolve: {
          fullySpecified: false,
        },
      });

      if (dev) {
        // Disable the problematic vendor bundle entirely for development
        config.optimization = {
          ...config.optimization,
          splitChunks: {
            chunks: 'all',
            minSize: 20000,
            maxSize: 244000,
            cacheGroups: {
              // Create separate chunks for different types of modules
              framework: {
                test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
                name: 'framework',
                chunks: 'all',
                priority: 40,
              },
              lib: {
                test: /[\\/]node_modules[\\/]((?!jsonwebtoken|bcrypt|crypto).)*[\\/]/,
                name: 'lib',
                chunks: 'all',
                priority: 30,
              },
              commons: {
                minChunks: 2,
                chunks: 'all',
                priority: 20,
                reuseExistingChunk: true,
              },
              // Don't bundle problematic packages at all
              default: false,
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

        // Enable persistent caching with absolute path
        config.cache = {
          type: 'filesystem',
          buildDependencies: {
            config: [__filename],
          },
          cacheDirectory: path.resolve(process.cwd(), '.next/cache/webpack'),
        };
      }
      
      return config;
    },
  }),
};

export default nextConfig;
