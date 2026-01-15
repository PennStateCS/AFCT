FROM node:20-alpine AS builder
WORKDIR /app

# Install Java (OpenJDK) for running .jar files during build if needed
RUN apk add --no-cache openjdk21-jre

# Ensure Next.js ignores ESLint during production build (mirrors next.config setting)
ENV NEXTJS_IGNORE_ESLINT=1

# Install all dependencies (including dev) for the build step
COPY package*.json ./
RUN npm ci

# Copy sources and generate Prisma client
COPY . .
RUN mkdir -p /app/bin /app/jars || true
# ENV DISABLE_ERD=true
# RUN npm run db:erd

# Build the Next.js app (requires devDependencies like Tailwind plugins)
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

# Install Java runtime and curl for health checks
RUN apk add --no-cache openjdk21-jre curl

COPY package*.json ./
# Ensure Prisma schema exists before postinstall so prisma generate can run if needed
COPY --from=builder /app/prisma ./prisma
# Install only production dependencies for smaller runtime image
RUN npm ci --omit=dev

# Copy build output and static assets from the builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/scripts ./scripts

# Copy jars directory from builder into runtime image (builder ensures dir exists)
COPY --from=builder /app/jars /app/jars
RUN chmod -R 755 /app/jars || true && chmod +x /app/jars/*.jar || true

# Copy bin directory from builder (may be empty) and ensure permissions
COPY --from=builder /app/bin /app/bin
RUN mkdir -p /app/bin && chmod -R 755 /app/bin || true

# Verify Java (non-fatal)
RUN java -version || true

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Change ownership of app directory
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
CMD ["npm", "start"]
