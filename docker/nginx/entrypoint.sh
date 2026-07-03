#!/bin/sh
set -eu

# nginx serves from ACTIVE_*; we choose between an admin-uploaded custom cert
# (mounted read-only from the app's volume) and an auto-generated self-signed
# cert. A short poll picks up cert changes from the app and hot-reloads. The
# self-signed cert is always the safe fallback so HTTPS can never be fully down.

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

# nginx:alpine ships without openssl
if ! command -v openssl >/dev/null 2>&1; then
  echo "[nginx] Installing openssl..."
  apk add --no-cache openssl >/dev/null
fi

mkdir -p "$ACTIVE_DIR"

ensure_self_signed() {
  if [ ! -f "$SELF_CRT" ] || [ ! -f "$SELF_KEY" ]; then
    echo "[nginx] Generating self-signed certificate..."
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
}

# Prefer the custom cert if present AND nginx accepts it; otherwise self-signed.
apply_certs() {
  ensure_self_signed
  if [ -f "$CUSTOM_CRT" ] && [ -f "$CUSTOM_KEY" ]; then
    cp "$CUSTOM_CRT" "$ACTIVE_CRT"
    cp "$CUSTOM_KEY" "$ACTIVE_KEY"
    chmod 600 "$ACTIVE_KEY"
    if nginx -t >/dev/null 2>&1; then
      echo "[nginx] Using custom TLS certificate"
      return 0
    fi
    echo "[nginx] Custom certificate rejected by nginx -t; falling back to self-signed"
  fi
  use_self_signed
  echo "[nginx] Using self-signed TLS certificate"
}

# Hash of the custom cert+key so we can detect changes, including removal.
fingerprint() {
  cat "$CUSTOM_CRT" "$CUSTOM_KEY" 2>/dev/null | sha256sum 2>/dev/null || echo "none"
}

# Guarantee a valid active cert before nginx starts.
ensure_self_signed
apply_certs || use_self_signed

# Poll for cert changes and hot-reload. Polling (not inotify) so it works across
# containers on Docker Desktop for Windows/Mac too.
(
  last="$(fingerprint)"
  while true; do
    sleep "$CERT_POLL_SECONDS"
    cur="$(fingerprint)"
    if [ "$cur" != "$last" ]; then
      echo "[nginx] TLS certificate change detected; reloading"
      apply_certs || use_self_signed
      nginx -s reload >/dev/null 2>&1 || true
      last="$cur"
    fi
  done
) &

echo "[nginx] Starting nginx..."
exec nginx -g "daemon off;"
