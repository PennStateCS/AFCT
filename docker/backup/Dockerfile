# Backup sidecar image: the Postgres image (so pg_dump matches the server
# version exactly) with backup.sh baked in. Publishing this (instead of
# bind-mounting backup.sh) lets the deploy bundle be a single compose file
# with no repo checkout. Kept on the same digest as the postgres service.
FROM postgres:15-alpine@sha256:fe0737ba566a2c5b2a28f34433c0a423261900ec17b9bf7ad115e1aae7e57f1b

# gnupg: symmetric AES-256 encryption of the backup archive.
# tar:   GNU tar, for repeating -C so the dump and the upload volumes go into one
#        archive without staging a second copy of the uploads on disk (BusyBox tar
#        does not support that). /usr/bin precedes /bin, so this shadows BusyBox.
RUN apk add --no-cache gnupg tar

COPY backup.sh /backup.sh

ENTRYPOINT ["/bin/sh", "/backup.sh"]
