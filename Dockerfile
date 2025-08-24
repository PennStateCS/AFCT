FROM node:18-alpine AS builder
WORKDIR /app

# Install Java (OpenJDK) for running .jar files during build if needed
RUN apk add --no-cache openjdk21-jre

# Install all dependencies (including dev) for the build step
COPY package*.json ./
RUN npm ci

# Copy sources and generate Prisma client
COPY . .
RUN mkdir -p /app/bin /app/jars || true
RUN npx prisma generate

# Build the Next.js app (requires devDependencies like Tailwind plugins)
RUN npm run build

FROM node:18-alpine AS runtime
WORKDIR /app

# Install Java runtime (OpenJDK) for running .jar files in the final image
RUN apk add --no-cache openjdk21-jre

# Install only production dependencies for smaller runtime image
COPY package*.json ./
RUN npm ci --omit=dev

# Copy build output and static assets from the builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.ts ./next.config.ts

# Copy jars directory from builder into runtime image (builder ensures dir exists)
COPY --from=builder /app/jars /app/jars
RUN chmod -R 644 /app/jars || true && chmod +x /app/jars/*.jar || true

# Copy bin directory from builder (may be empty) and ensure permissions
COPY --from=builder /app/bin /app/bin
RUN mkdir -p /app/bin && chmod -R 755 /app/bin || true

# Verify Java (non-fatal)
RUN java -version || true

EXPOSE 3000
CMD ["npm", "start"]
