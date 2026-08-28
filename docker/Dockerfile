# Production image for the AFCT dashboard.
#
# Built in two stages: `builder` compiles the app with the full toolchain, then
# `runtime` copies out only what's needed to run it. Leaving the compilers behind
# keeps the final image smaller and its attack surface small.
#
# Base images are pinned by digest (the tag is kept alongside for readability) so
# a rebuild always uses the exact same image. Bump these deliberately.

# --- Stage 1: build ---
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS builder
WORKDIR /app

ENV SKIP_PRISMA_GENERATE=1
ENV NEXTJS_IGNORE_ESLINT=1

# python3/make/g++ compile native npm modules (bcrypt). No Java here; the build
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
RUN npx prisma generate --generator client && npm run build

# --- Stage 2: runtime ---
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime
WORKDIR /app

# curl runs the healthcheck; postgres-client + netcat back the DB wait in the
# entrypoint; tini is PID 1; openssl covers TLS helpers. fontconfig + a base font
# are required by the Java evaluator (JFLAP initializes Swing even in CLI mode, so
# the JRE needs font metrics; otherwise it throws "Fontconfig head is null").
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    curl postgresql-client netcat-openbsd tini openssl ca-certificates \
    fontconfig fonts-dejavu-core

# Java 21 runtime, copied from the official image (pinned, no network fetch).
# Runs jars/afct-evaluator.jar when grading submissions.
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"
COPY --from=eclipse-temurin:21-jre@sha256:7a65df4b22d2de92d4e04056e884f3b9122d70b21e2847fd66084278bd0ce037 /opt/java/openjdk /opt/java/openjdk

# npm's default cache path isn't writable by the node user.
ENV NPM_CONFIG_CACHE=/tmp/.npm

# Runtime env (mirrors the dev image). NODE_ENV/telemetry are set here so the
# image behaves correctly even when run without compose. The entrypoint may run
# `prisma generate` when the client is missing; every generator in the schema
# writes text, so that needs nothing installed beyond node_modules.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PATH="/app/bin:${PATH}"

# Directories the container writes into that live outside /app, so they have to be made
# while we are still root. Ownership is set as they are created, not fixed up afterwards.
#
# `private` holds solutions/submissions the app gates behind auth; compose mounts named
# volumes here so uploads survive a container replacement.
RUN mkdir -p /private/uploads/pfps /private/uploads/problems \
             /private/uploads/solutions /private/uploads/submissions && \
    chmod -R 775 /private/uploads && \
    chown -R node:node /private/uploads

# Trigger volumes the app writes into (upgrade requests for the updater sidecar, and
# backup-now flags for the backup sidecar). Same reason as above: create them in the
# image so their named volumes inherit node ownership, or the app (uid node) can't drop
# a request and in-app upgrades / on-demand backups fail with a permission error.
RUN mkdir -p /update-triggers /backup-triggers \
  && chown node:node /update-triggers /backup-triggers

# Everything below runs as the unprivileged user the container runs as, so each file
# lands owned by `node` as it is written.
#
# This stage used to end with `chown -R node:node /app`, which cost 1.5 GB on its own.
# Changing a file's owner changes its metadata, and overlayfs can only record that by
# copying the file up into a new layer, so the image carried a second complete copy of
# node_modules and .next. /app is still empty here, so this chown is one directory.
RUN chown node:node /app
USER node

# Holds the admin-uploaded TLS cert; nginx reads it through a shared volume.
RUN mkdir -p /app/certs && chmod 750 /app/certs

# ACME HTTP-01 challenge webroot. Must exist in the image so the named volume
# mounted here inherits node ownership; otherwise the app (uid node) can't write
# challenge tokens and Let's Encrypt issuance fails.
RUN mkdir -p /app/acme-challenge && chmod 755 /app/acme-challenge

# Production deps only. SKIP_PRISMA_GENERATE stops the postinstall hook from
# regenerating the client; the builder already made it and we copy it below.
# Installed as `node` so node_modules needs no ownership fix, and so the entrypoint's
# fallback `prisma generate` can still write into it.
ENV SKIP_PRISMA_GENERATE=1
COPY --chown=node:node package*.json ./
COPY --from=builder --chown=node:node /app/prisma ./prisma
# Prisma 7 reads the datasource url (and the seed command) from prisma.config.ts, not
# schema.prisma, so the runtime needs it or `prisma migrate deploy`/`db seed` fail with
# "The datasource.url property is required in your Prisma config file".
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
RUN npm ci --omit=dev --legacy-peer-deps --prefer-offline --no-audit --progress=false

# Prisma client generated in the builder stage.
COPY --from=builder --chown=node:node /app/node_modules/@prisma /app/node_modules/@prisma
COPY --from=builder --chown=node:node /app/node_modules/.prisma /app/node_modules/.prisma

# Compiled app + static assets.
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts

# Worker source: the submission worker runs standalone (`npx tsx src/worker.ts`) in the
# dedicated, network-isolated `worker` compose service. tsx is a production dependency and
# executes the TypeScript directly, resolving the `@/*` alias from tsconfig.json, so ship
# the source it needs (src/ + the repo-root lib/java-runner.js). The web app ignores these:
# it runs the compiled .next build, not the source.
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/lib ./lib
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json

# Evaluator JAR and the cfganalyzer binary it shells out to. --chmod sets the mode during
# the copy; the `chmod -R` this replaces duplicated all 32 MB of them into another layer.
COPY --from=builder --chown=node:node --chmod=755 /app/jars /app/jars
COPY --from=builder --chown=node:node --chmod=755 /app/bin /app/bin

# Startup script: waits for the DB, migrates, seeds, then starts the app.
COPY --from=builder --chown=node:node --chmod=755 /app/docker/entrypoint.sh ./docker/entrypoint.sh

# Fail the build now if the copied JRE can't run, not later at grading time.
RUN java -version

EXPOSE 3000

# tini forwards signals and reaps zombies; the entrypoint preps the DB then
# execs the CMD.
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/bin/sh", "./docker/entrypoint.sh"]
CMD ["npm", "start"]
