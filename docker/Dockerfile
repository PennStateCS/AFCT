# Production image for the AFCT dashboard.
#
# Built in two stages: `builder` compiles the app with the full toolchain, then
# `runtime` copies out only what's needed to run it. Leaving the compilers behind
# keeps the final image smaller and its attack surface small.
#
# Base images are pinned by digest (the tag is kept alongside for readability) so
# a rebuild always uses the exact same image. Bump these deliberately.

# --- Stage 1: build ---
FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS builder
WORKDIR /app

# The ERD generator and lint are dev-only; skip them during the image build.
ENV DISABLE_ERD=true
ENV SKIP_PRISMA_GENERATE=1
ENV NEXTJS_IGNORE_ESLINT=1
# The ERD generator pulls in puppeteer (via mermaid-cli), whose install would
# otherwise download a ~150MB Chromium we never use — the ERD step is disabled here.
ENV PUPPETEER_SKIP_DOWNLOAD=1

# python3/make/g++ compile native npm modules (bcrypt). No Java here — the build
# never runs the evaluator JAR, so a JRE would just be dead weight.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git openssl ca-certificates

# Install deps in their own layer so source edits don't invalidate the npm cache.
COPY package*.json ./
RUN npm ci --legacy-peer-deps --prefer-offline --no-audit --progress=false

# Generate the Prisma client, then build Next.js.
COPY . .
RUN mkdir -p /app/bin /app/jars
RUN npx prisma generate && npm run build

# --- Stage 2: runtime ---
FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS runtime
WORKDIR /app

# curl runs the healthcheck; postgres-client + netcat back the DB wait in the
# entrypoint; tini is PID 1; openssl covers TLS helpers. fontconfig + a base font
# are required by the Java evaluator (JFLAP initializes Swing even in CLI mode, so
# the JRE needs font metrics — otherwise it throws "Fontconfig head is null").
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    curl postgresql-client netcat-openbsd tini openssl ca-certificates \
    fontconfig fonts-dejavu-core

# Java 21 runtime, copied from the official image (pinned, no network fetch).
# Runs jars/afct-evaluator.jar when grading submissions.
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"
COPY --from=eclipse-temurin:21-jre@sha256:d2b9f8f12212cadcfdf889461531784e8fd097feade954d65b31ee7a71c473ec /opt/java/openjdk /opt/java/openjdk

# npm's default cache path isn't writable by the node user.
ENV NPM_CONFIG_CACHE=/tmp/.npm

# Runtime env (mirrors the dev image). NODE_ENV/telemetry are set here so the
# image behaves correctly even when run without compose; DISABLE_ERD keeps the
# ERD generator from running if the entrypoint ever regenerates the client.
ENV NODE_ENV=production
ENV DISABLE_ERD=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV PATH="/app/bin:${PATH}"

# Production deps only. SKIP_PRISMA_GENERATE stops the postinstall hook from
# regenerating the client — the builder already made it and we copy it below.
ENV SKIP_PRISMA_GENERATE=1
COPY package*.json ./
COPY --from=builder /app/prisma ./prisma
RUN npm ci --omit=dev --legacy-peer-deps --prefer-offline --no-audit --progress=false

# Prisma client generated in the builder stage.
COPY --from=builder /app/node_modules/@prisma /app/node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma

# Compiled app + static assets.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

# Evaluator JAR and the cfganalyzer binary it shells out to.
COPY --from=builder /app/jars /app/jars
COPY --from=builder /app/bin /app/bin
RUN chmod -R 755 /app/jars /app/bin && \
    find /app/jars -name '*.jar' -exec chmod +x {} \;

# Startup script: waits for the DB, migrates, seeds, then starts the app.
COPY --from=builder /app/docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

# Upload dirs. `private` holds solutions/submissions the app gates behind auth;
# compose mounts named volumes here so uploads survive a container replacement.
RUN mkdir -p /private/uploads/pfps /private/uploads/problems \
             /private/uploads/solutions /private/uploads/submissions && \
    chmod -R 775 /private/uploads

# Holds the admin-uploaded TLS cert; nginx reads it through a shared volume.
RUN mkdir -p /app/certs && chmod 750 /app/certs

# Give everything to the non-root user the container runs as.
RUN chown -R node:node /app /private/uploads

# Fail the build now if the copied JRE can't run, not later at grading time.
RUN java -version

USER node
EXPOSE 3000

# tini forwards signals and reaps zombies; the entrypoint preps the DB then
# execs the CMD.
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/bin/sh", "./docker/entrypoint.sh"]
CMD ["npm", "start"]
