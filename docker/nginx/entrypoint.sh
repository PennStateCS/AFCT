#!/bin/sh
set -eu

CERT_DIR="/etc/nginx/certs"
CERT_KEY="${CERT_DIR}/server.key"
CERT_CRT="${CERT_DIR}/server.crt"

SSL_DAYS="${SSL_DAYS:-3650}"
SSL_SUBJECT="${SSL_SUBJECT:-/C=US/ST=State/L=City/O=AFCT/OU=Dev/CN=localhost}"

# Ensure openssl exists (nginx:alpine does not include it)
if ! command -v openssl >/dev/null 2>&1; then
  echo "[nginx] Installing openssl..."
  apk add --no-cache openssl >/dev/null
fi

mkdir -p "$CERT_DIR"

# Generate cert only once (certs volume persists)
if [ ! -f "$CERT_KEY" ] || [ ! -f "$CERT_CRT" ]; then
  echo "[nginx] Generating self-signed TLS certificate..."
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$CERT_KEY" \
    -out "$CERT_CRT" \
    -days "$SSL_DAYS" \
    -subj "$SSL_SUBJECT" \
    >/dev/null 2>&1

  chmod 600 "$CERT_KEY"
else
  echo "[nginx] Using existing TLS certificate"
fi

echo "[nginx] Starting nginx..."
exec nginx -g "daemon off;"
