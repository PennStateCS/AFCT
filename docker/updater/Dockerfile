# AFCT updater sidecar: performs admin-requested application upgrades.
#
# It holds the Docker socket and swaps the app image tag on request; the app
# itself never touches Docker (it only drops a request file in a shared volume).
# Based on the official Docker CLI image, which bundles the Compose plugin.
FROM docker:27-cli

# jq for safe JSON handling; curl to fetch the remote release manifest over HTTPS;
# tini for correct signal/zombie handling as PID 1. docker-cli-compose is already
# present in the base image; requesting it is a no-op that guards against a base
# that ever drops it.
RUN apk add --no-cache jq curl tini docker-cli-compose

COPY updater.sh /usr/local/bin/updater.sh
RUN chmod +x /usr/local/bin/updater.sh

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/updater.sh"]
