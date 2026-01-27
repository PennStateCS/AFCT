FROM node:20-alpine AS builder
WORKDIR /app

ENV DISABLE_ERD=true
ENV SKIP_PRISMA_GENERATE=1

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
# RUN npm run db:erd

# Build the Next.js app (requires devDependencies like Tailwind plugins)
RUN npx prisma generate
RUN npm run build


FROM node:20-alpine AS runtime
WORKDIR /app

# Install Java runtime, curl, and tools needed by entrypoint.sh (pg_isready + nc)
RUN apk add --no-cache \
    openjdk21-jre \
    curl \
    postgresql-client \
    netcat-openbsd

# Optional: keep npm cache writable for non-root user
ENV NPM_CONFIG_CACHE=/tmp/.npm

COPY package*.json ./

# Ensure Prisma schema exists before postinstall so prisma generate can run if needed
COPY --from=builder /app/prisma ./prisma

# Install only production dependencies for smaller runtime image
# NOTE: prisma CLI must be in "dependencies" (not devDependencies) for npx prisma to work reliably
RUN npm ci --omit=dev

# Copy generated Prisma client artifacts into runtime image to ensure @prisma/client is available
COPY --from=builder /app/node_modules/@prisma /app/node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma

# Copy build output and static assets from the builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/scripts ./scripts

# Create private folder (sibling to public) and ensure it is writable
RUN mkdir -p /app/private && chmod 775 /app/private

# Copy jars directory from builder into runtime image (builder ensures dir exists)
COPY --from=builder /app/jars /app/jars
RUN chmod -R 755 /app/jars || true && chmod +x /app/jars/*.jar || true

# Copy bin directory from builder (may be empty) and ensure permissions
COPY --from=builder /app/bin /app/bin
RUN mkdir -p /app/bin && chmod -R 755 /app/bin || true

# Verify Java (non-fatal)
RUN java -version || true

# Copy entrypoint script into runtime image and ensure it is executable
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Change ownership of app directory
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

# Run entrypoint first (wait for DB, migrations, etc.)
ENTRYPOINT ["./entrypoint.sh"]

# Then start the Next.js server
CMD ["npm", "start"]
