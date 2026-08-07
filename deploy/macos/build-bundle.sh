#!/bin/sh
# Assemble the versioned AFCT macOS deployment bundle.
#
# Shares one source of truth with the Linux build: the platform-neutral modules and the
# controller in deploy/unix/, plus the SHARED Compose file and env template in deploy/.
# It swaps in the macOS platform library and the macOS service-account stub (deploy/macos/
# lib) and the macOS bootstrap (deploy/macos/install.sh). The result is a self-contained
# bundle with a flat lib/, exactly like the Linux bundle but for Docker Desktop.
#
# Usage:
#   sh deploy/macos/build-bundle.sh [output-dir]
#
# Produces, in the output directory (default deploy/dist):
#   afct-macos-deploy-<version>.tar.gz
#   afct-macos-deploy-<version>.tar.gz.sha256
#   deployment-manifest-macos.json

set -eu

MACOS_DIR=$(unset CDPATH; cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(unset CDPATH; cd -- "${MACOS_DIR}/.." && pwd)
UNIX_DIR="${DEPLOY_DIR}/unix"
OUT_DIR=${1:-${DEPLOY_DIR}/dist}

VERSION=$(sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "${UNIX_DIR}/bin/afctctl" | head -n 1)
[ -n "$VERSION" ] || { printf 'ERROR: could not read INSTALLER_VERSION from unix/bin/afctctl\n' >&2; exit 1; }

NAME="afct-macos-deploy-${VERSION}"

# Required sources.
for _f in "${DEPLOY_DIR}/docker-compose.yml" "${DEPLOY_DIR}/.env.production.example" \
          "${UNIX_DIR}/bin/afctctl" "${MACOS_DIR}/install.sh" \
          "${MACOS_DIR}/lib/platform.sh" "${MACOS_DIR}/lib/service-user.sh"; do
  [ -f "$_f" ] || { printf 'ERROR: missing source file: %s\n' "$_f" >&2; exit 1; }
done

_stage=$(mktemp -d "${TMPDIR:-/tmp}/afct-bundle.XXXXXX") || { printf 'ERROR: mktemp failed\n' >&2; exit 1; }
trap 'rm -rf "$_stage" 2>/dev/null || true' EXIT INT TERM

_root="${_stage}/${NAME}"
mkdir -p "${_root}/bin" "${_root}/lib"

cp "${MACOS_DIR}/install.sh" "${_root}/install.sh"
cp "${UNIX_DIR}/bin/afctctl" "${_root}/bin/afctctl"
# Shared Unix libraries plus the macOS-only platform library and service-account stub,
# flattened into one lib/ directory (the runtime afctctl sources them from the release's
# flat lib/, so the source split is invisible after packaging).
cp "${UNIX_DIR}"/lib/*.sh "${_root}/lib/"
cp "${MACOS_DIR}"/lib/*.sh "${_root}/lib/"
[ -f "${DEPLOY_DIR}/.shellcheckrc" ] && cp "${DEPLOY_DIR}/.shellcheckrc" "${_root}/.shellcheckrc"
cp "${DEPLOY_DIR}/docker-compose.yml" "${_root}/docker-compose.yml"
cp "${DEPLOY_DIR}/.env.production.example" "${_root}/.env.production.example"
printf '%s\n' "$VERSION" > "${_root}/DEPLOY_VERSION"
chmod 0755 "${_root}/install.sh" "${_root}/bin/afctctl" 2>/dev/null || true

mkdir -p "$OUT_DIR"
_tarball="${OUT_DIR}/${NAME}.tar.gz"
# Reproducible archive where GNU tar is available; a plain archive otherwise (local dev).
# macOS ships bsdtar, which lacks --sort/--mtime, so this falls back there.
if tar --version 2>/dev/null | grep -qi 'GNU tar' && command -v gzip >/dev/null 2>&1; then
  tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
    -C "$_stage" -cf - "$NAME" | gzip -n -9 > "$_tarball"
else
  tar -C "$_stage" -czf "$_tarball" "$NAME"
fi

( cd "$OUT_DIR" && \
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${NAME}.tar.gz"
  else
    shasum -a 256 "${NAME}.tar.gz"
  fi ) > "${_tarball}.sha256"

# macOS deployment manifest. Distinct asset name from the Linux manifest so a macOS host
# self-updates against the macOS bundle. The bootstrap asset name is the macOS installer.
_sha=$(awk '{ print $1; exit }' "${_tarball}.sha256")
[ -n "$_sha" ] || { printf 'ERROR: could not read the bundle checksum\n' >&2; exit 1; }
cat > "${OUT_DIR}/deployment-manifest-macos.json" <<EOF
{
  "schema": "afct-deployment-manifest/v1",
  "deploymentToolVersion": "${VERSION}",
  "bundle": "${NAME}.tar.gz",
  "sha256": "${_sha}",
  "bootstrap": "install-macos.sh"
}
EOF

printf '%s\n' "$_tarball"
