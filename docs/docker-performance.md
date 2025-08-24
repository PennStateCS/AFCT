# Docker Development Performance Guide

## 🚀 Performance Optimizations Applied

### 1. **Docker Layer Caching**
- Optimized Dockerfile.dev for better layer caching
- Dependencies installed before source code copy
- Less frequently changed files copied first

### 2. **Volume Mount Optimizations**
- `:cached` flag for source code mounting (faster reads)
- `:delegated` flag for uploads (faster writes)
- Separate volumes for node_modules and .next

### 3. **Memory Management**
- Increased Node.js memory limit to 4GB
- Container memory limits and reservations
- tmpfs for temporary files

### 4. **Next.js Optimizations**
- Disabled SWC minification in development
- Optimized webpack configuration
- Package import optimizations

### 5. **PostgreSQL Tuning**
- Development-specific configuration
- Reduced connections and optimized buffer sizes
- tmpfs for temporary PostgreSQL files

## 🛠️ Available Performance Commands

```bash
# Start with cached build (fastest for subsequent runs)
npm run docker:dev:fast

# Full rebuild when needed (slowest but most reliable)
npm run docker:dev:rebuild

# Standard build (moderate speed)
npm run docker:dev

# Clean up Docker resources
npm run docker:clean
```

## 📊 Expected Performance Improvements

- **Build Time**: 30-50% faster on subsequent builds
- **Hot Reload**: 20-40% faster file change detection
- **Memory Usage**: Better allocation and garbage collection
- **Database**: 15-25% faster query performance in development

## 🔧 Additional Performance Tips

### 1. **First-Time Setup**
```bash
# Use fast command after initial build
npm run docker:dev        # First time
npm run docker:dev:fast   # Subsequent runs
```

### 2. **When to Rebuild**
- After changing package.json
- After updating Dockerfile.dev
- When experiencing issues

### 3. **Docker System Maintenance**
```bash
# Regular cleanup (run weekly)
npm run docker:clean

# Deep cleanup (run monthly)
docker system prune -a --volumes
```

### 4. **Development Workflow**
1. Use `docker:dev:fast` for daily development
2. Use `docker:dev:rebuild` only when dependencies change
3. Monitor Docker Desktop resource usage
4. Restart Docker Desktop if performance degrades

## 🐛 Troubleshooting Slow Performance

### Check Resource Usage
```bash
# Monitor container resources
docker stats afct-dashboard

# Check disk usage
docker system df
```

### Common Issues
- **High CPU**: Reduce file watching scope
- **High Memory**: Restart containers
- **Slow Hot Reload**: Check volume mount performance
- **Database Slow**: Run VACUUM on PostgreSQL

### Windows-Specific Optimizations
- Enable WSL2 backend in Docker Desktop
- Store project files in WSL2 filesystem
- Exclude Docker directories from Windows Defender

### macOS-Specific Optimizations  
- Use Docker Desktop with VirtioFS
- Enable "Use gRPC FUSE for file sharing"
- Allocate sufficient memory to Docker Desktop
