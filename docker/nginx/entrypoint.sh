#!/bin/sh
# Picks the TLS cert nginx serves and keeps it current.
#
# nginx serves whatever is in ACTIVE_*. We prefer an admin-uploaded cert (mounted
# read-only from the app) but always fall back to a self-signed one so HTTPS can
# never be fully down. A background poll picks up cert changes and hot-reloads.
set -eu

log() { echo "[nginx] $*"; }

ACTIVE_DIR="/etc/nginx/certs"
ACTIVE_CRT="${ACTIVE_DIR}/server.crt"
ACTIVE_KEY="${ACTIVE_DIR}/server.key"

SELF_CRT="${ACTIVE_DIR}/selfsigned.crt"
SELF_KEY="${ACTIVE_DIR}/selfsigned.key"

CUSTOM_DIR="/etc/nginx/custom-certs"
CUSTOM_CRT="${CUSTOM_DIR}/server.crt"
CUSTOM_KEY="${CUSTOM_DIR}/server.key"

SSL_DAYS="${SSL_DAYS:-3650}"
SSL_SUBJECT="${SSL_SUBJECT:-/C=US/ST=State/L=City/O=AFCT/OU=Dev/CN=localhost}"
CERT_POLL_SECONDS="${CERT_POLL_SECONDS:-15}"

# default.conf `include`s this file; write_hsts fills it based on the active cert.
HSTS_CONF="/etc/nginx/hsts.conf"
HSTS_HEADER='add_header Strict-Transport-Security "max-age=31536000" always;'

# HSTS is only safe with a real cert: once a browser sees it, it won't let the
# user click through a self-signed warning for a year. So on=real, off=self-signed.
write_hsts() {
  if [ "$1" = "on" ]; then
    printf '%s\n' "$HSTS_HEADER" > "$HSTS_CONF"
  else
    : > "$HSTS_CONF"
  fi
}

# openssl is baked into our image; this only matters if run on a stock nginx.
if ! command -v openssl >/dev/null 2>&1; then
  log "installing openssl"
  apk add --no-cache openssl >/dev/null
fi

mkdir -p "$ACTIVE_DIR"

# The include must exist before any `nginx -t`, or config validation fails.
write_hsts off

# Generate the self-signed fallback once.
ensure_self_signed() {
  if [ ! -f "$SELF_CRT" ] || [ ! -f "$SELF_KEY" ]; then
    log "generating self-signed certificate"
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout "$SELF_KEY" -out "$SELF_CRT" \
      -days "$SSL_DAYS" -subj "$SSL_SUBJECT" >/dev/null 2>&1
    chmod 600 "$SELF_KEY"
  fi
}

use_self_signed() {
  cp "$SELF_CRT" "$ACTIVE_CRT"
  cp "$SELF_KEY" "$ACTIVE_KEY"
  chmod 600 "$ACTIVE_KEY"
  write_hsts off
}

# Use the admin cert only if present and nginx accepts it; otherwise self-signed.
apply_certs() {
  ensure_self_signed
  if [ -f "$CUSTOM_CRT" ] && [ -f "$CUSTOM_KEY" ]; then
    cp "$CUSTOM_CRT" "$ACTIVE_CRT"
    cp "$CUSTOM_KEY" "$ACTIVE_KEY"
    chmod 600 "$ACTIVE_KEY"
    if nginx -t >/dev/null 2>&1; then
      write_hsts on
      log "using custom TLS certificate"
      return 0
    fi
    log "custom certificate rejected by nginx -t; falling back to self-signed"
  fi
  use_self_signed
  log "using self-signed TLS certificate"
}

# Hash the custom cert+key so we can detect any change, including removal.
fingerprint() {
  cat "$CUSTOM_CRT" "$CUSTOM_KEY" 2>/dev/null | sha256sum 2>/dev/null || echo "none"
}

# Guarantee a valid cert before nginx starts.
ensure_self_signed
apply_certs || use_self_signed

# Watch for cert changes and hot-reload. Polling (not inotify) works across the
# volume on Docker Desktop for Windows/Mac.
(
  last="$(fingerprint)"
  while true; do
    sleep "$CERT_POLL_SECONDS"
    cur="$(fingerprint)"
    if [ "$cur" != "$last" ]; then
      log "certificate change detected; reloading"
      apply_certs || use_self_signed
      nginx -s reload >/dev/null 2>&1 || true
      last="$cur"
    fi
  done
) &

log "starting nginx"
exec nginx -g "daemon off;"
