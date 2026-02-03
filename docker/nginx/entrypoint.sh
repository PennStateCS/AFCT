#!/bin/sh
set -e

CERT_DIR="/etc/nginx/certs"
CERT_KEY="${CERT_DIR}/server.key"
CERT_CRT="${CERT_DIR}/server.crt"
SSL_DAYS="${SSL_DAYS:-3650}"
SSL_SUBJECT="${SSL_SUBJECT:-/C=US/ST=State/L=City/O=AFCT/OU=Dev/CN=localhost}"

if ! command -v openssl >/dev/null 2>&1; then
  apk add --no-cache openssl
fi

mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_KEY" ] || [ ! -f "$CERT_CRT" ]; then
  echo "Generating self-signed certificate..."
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$CERT_KEY" \
    -out "$CERT_CRT" \
    -days "$SSL_DAYS" \
    -subj "$SSL_SUBJECT"
  chmod 600 "$CERT_KEY"
fi

echo "Starting nginx..."
exec nginx -g 'daemon off;'
