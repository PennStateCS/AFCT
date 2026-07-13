# Backup sidecar image: the Postgres image (so pg_dump matches the server
# version exactly) with backup.sh baked in. Publishing this — instead of
# bind-mounting backup.sh — lets the deploy bundle be a single compose file
# with no repo checkout. Kept on the same digest as the postgres service.
FROM postgres:15-alpine@sha256:cd17e2ac98240fce1541ad2a803b34009b4eea5aec8a832363cdc7eca62e722e

COPY backup.sh /backup.sh

ENTRYPOINT ["/bin/sh", "/backup.sh"]
