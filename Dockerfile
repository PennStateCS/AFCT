# ----------------------------
# Builder
# ----------------------------
FROM node:20-bullseye-slim AS builder
WORKDIR /app

# Set environment variables for build
ENV DISABLE_ERD=true
ENV SKIP_PRISMA_GENERATE=1
ENV NEXTJS_IGNORE_ESLINT=1

# Install build tools + Java (OpenJDK) for running .jar files during build if needed
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    python3 \
    make \
    g++ \
    git \
    openjdk-17-jre-headless \
    ca-certificates

# Install all dependencies (including dev) for the build step
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy sources
COPY . .

RUN mkdir -p /app/bin /app/jars || true

# Generate Prisma client + build
RUN set -e && \
    npx prisma generate && \
    npm run build

# ----------------------------
# Runtime
# ----------------------------
FROM node:20-bullseye-slim AS runtime
WORKDIR /app

# Install runtime tools (combined in single RUN for better caching)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    curl \
    postgresql-client \
    netcat-openbsd \
    tini \
    ca-certificates

# Set npm cache directory
ENV NPM_CONFIG_CACHE=/tmp/.npm

# Ensure app directory is writable by node user
RUN chown -R node:node /app

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
RUN chmod -R 755 /app/jars && \
    find /app/jars -name "*.jar" -exec chmod +x {} \;

COPY --from=builder /app/bin /app/bin
RUN mkdir -p /app/bin && chmod -R 755 /app/bin

# Handles Prisma Studio
# Expose the default Prisma Studio port
EXPOSE 5555

# Copy entrypoint script into runtime image and ensure it is executable
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Private upload directories
RUN mkdir -p /private/uploads/pfps \
    /private/uploads/problems \
    /private/uploads/solutions \
    /private/uploads/submissions && \
    chmod -R 775 /private/uploads && \
    chown -R node:node /private/uploads

# Declare upload volumes for persistence
VOLUME ["/private/uploads", "/app/public/uploads"]

# App ownership
RUN chown -R node:node /app

# Verify Java installation
RUN java -version || true

# Switch to non-root user
USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini","-g","--","/bin/sh","./entrypoint.sh"]
CMD ["npm", "start"]