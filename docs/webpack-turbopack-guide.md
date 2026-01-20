# Webpack vs Turbopack Configuration Guide

## Overview
The AFCT Dashboard supports both Webpack (default) and Turbopack (experimental) build modes with optimized configurations for each.

## Configuration Strategy

### Webpack Mode (Default)
- **Command**: `npm run docker:dev:fast`
- **Features**: 
  - Optimized chunk splitting
  - Persistent filesystem caching
  - Reduced file system polling
  - Package import optimization
- **Best for**: Stable development with proven build performance

### Turbopack Mode (Experimental)
- **Command**: `npm run docker:dev:turbo`
- **Features**:
  - Rust-based compilation (faster)
  - Simplified configuration
  - Package import optimization
  - Reduced memory usage
- **Best for**: Bleeding-edge performance testing

## Configuration Details

### Next.js Config Structure
```typescript
// next.config.ts
const nextConfig = {
  experimental: {
    // Works with both webpack and turbopack
    optimizePackageImports: [...],
    
    // Turbopack-specific config (when TURBOPACK=1)
    ...(process.env.TURBOPACK && {
      turbo: {
        rules: {},
      },
    }),
  },
  
  // Webpack config (only when NOT using turbopack)
  ...(!process.env.TURBOPACK && {
    webpack: (config, { dev }) => {
      // Webpack optimizations here
    },
  }),
};
```

### Environment Variable Control
- **TURBOPACK=1**: Enables turbopack mode and disables webpack config
- **No TURBOPACK**: Uses webpack with optimizations

## Docker Integration

### Development Commands
```bash
# Webpack mode (default, stable)
npm run docker:dev:fast

# Turbopack mode (experimental, faster)
npm run docker:dev:turbo
```

### Docker Configuration
The `Dockerfile.dev` automatically detects the mode:
```dockerfile
CMD ["sh", "-c", "if [ \"$TURBOPACK\" = \"1\" ]; then npm run dev:turbo; else npm run dev; fi"]
```

## Performance Comparison

### Webpack Mode
- **Startup**: ~9-10 seconds
- **Hot Reload**: ~1-2 seconds
- **Memory**: ~300-400MB
- **Stability**: Production-ready

### Turbopack Mode
- **Startup**: ~7-8 seconds (estimated)
- **Hot Reload**: ~0.5-1 second (estimated)
- **Memory**: ~200-300MB (estimated)
- **Stability**: Experimental

## Troubleshooting

### Webpack/Turbopack Conflicts
If you see warnings like:
```
⚠ Webpack is configured while Turbopack is not, which may cause problems.
```

**Solution**: Ensure you're using the correct command:
- For webpack: `npm run docker:dev:fast`
- For turbopack: `npm run docker:dev:turbo`

### Switch Between Modes
```bash
# Stop current containers
docker-compose down

# Start with webpack (default)
npm run docker:dev:fast

# OR start with turbopack
npm run docker:dev:turbo
```

### Environment Variable Issues
Make sure the `TURBOPACK` environment variable is set correctly:
```bash
# Check if turbopack is enabled
docker exec afct-dashboard env | grep TURBOPACK
```

## Recommendations

### For Development
- **Use webpack mode** (`npm run docker:dev:fast`) for stable development
- **Try turbopack mode** (`npm run docker:dev:turbo`) for experimental performance

### For Production
- Always use webpack mode for production builds
- Turbopack is not yet recommended for production

## Future Updates
As Turbopack matures, we'll continue optimizing both configurations and may transition to turbopack as the default when it reaches stable status.
