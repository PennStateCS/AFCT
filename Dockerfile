# ----------------------------
# Builder
# ----------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Set environment variables for build
ENV DISABLE_ERD=true
ENV SKIP_PRISMA_GENERATE=1
ENV NEXTJS_IGNORE_ESLINT=1

# Install Java (OpenJDK) for running .jar files during build if needed
RUN apk add --no-cache openjdk21-jre

# Install all dependencies (including dev) for the build step
COPY package*.json ./
RUN npm ci

# Copy sources
COPY . .

RUN mkdir -p /app/bin /app/jars || true

# Generate Prisma client + build
RUN npx prisma generate
RUN npm run build


# ----------------------------
# Runtime
# ----------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

# Install runtime tools
RUN apk add --no-cache \
    openjdk21-jre \
    curl \
    postgresql-client \
    netcat-openbsd

# Set npm cache directory
ENV NPM_CONFIG_CACHE=/tmp/.npm

# App dependencies
COPY package*.json ./

# Prisma schema + production deps
COPY --from=builder /app/prisma ./prisma
RUN npm ci --omit=dev

# Prisma client artifacts
COPY --from=builder /app/node_modules/@prisma /app/node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma

# App build + assets
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/scripts ./scripts

# Jars + bin
COPY --from=builder /app/jars /app/jars
RUN chmod -R 755 /app/jars || true && chmod +x /app/jars/*.jar || true

COPY --from=builder /app/bin /app/bin
RUN mkdir -p /app/bin && chmod -R 755 /app/bin || true

# Entrypoint
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nextjs -u 1001 -G nodejs

# Private upload directories
RUN mkdir -p /private/uploads/pfps \
    /private/uploads/problems \
    /private/uploads/solutions \
    /private/uploads/submissions && \
    chown -R nextjs:nodejs /private/uploads && \
    chmod -R 775 /private/uploads

# App ownership
RUN chown -R nextjs:nodejs /app

# Verify Java installation
RUN java -version || true

# Switch to non-root user
USER nextjs
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm", "start"]