#!/bin/sh
# Assemble the versioned AFCT Linux deployment bundle.
#
# The bundle is built from a single source of truth: the SHARED Unix modules in
# deploy/unix/ (afctctl and the platform-neutral libraries), the Linux-only libraries in
# deploy/linux/lib/ (service-user.sh, platform.sh), the Linux bootstrap in deploy/linux/,
# and the SHARED Compose file and env template in deploy/ (the same files the Windows and
# macOS installers use). There are therefore no duplicated modules to keep in sync; this
# script (and the CI check that runs it) is the generation + verification mechanism. The
# macOS bundle is assembled the same way by deploy/macos/build-bundle.sh, sharing
# deploy/unix and swapping in the macOS platform library.
#
# Usage:
#   sh deploy/linux/build-bundle.sh [output-dir]
#
# Produces, in the output directory (default deploy/dist):
#   afct-linux-deploy-<version>.tar.gz
#   afct-linux-deploy-<version>.tar.gz.sha256

set -eu

LINUX_DIR=$(unset CDPATH; cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(unset CDPATH; cd -- "${LINUX_DIR}/.." && pwd)
UNIX_DIR="${DEPLOY_DIR}/unix"
OUT_DIR=${1:-${DEPLOY_DIR}/dist}

VERSION=$(sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "${UNIX_DIR}/bin/afctctl" | head -n 1)
[ -n "$VERSION" ] || { printf 'ERROR: could not read INSTALLER_VERSION from unix/bin/afctctl\n' >&2; exit 1; }

NAME="afct-linux-deploy-${VERSION}"

# Required shared sources.
for _f in "${DEPLOY_DIR}/docker-compose.yml" "${DEPLOY_DIR}/.env.production.example" \
          "${UNIX_DIR}/bin/afctctl" "${LINUX_DIR}/install.sh" \
          "${LINUX_DIR}/lib/service-user.sh" "${LINUX_DIR}/lib/platform.sh"; do
  [ -f "$_f" ] || { printf 'ERROR: missing source file: %s\n' "$_f" >&2; exit 1; }
done

_stage=$(mktemp -d "${TMPDIR:-/tmp}/afct-bundle.XXXXXX") || { printf 'ERROR: mktemp failed\n' >&2; exit 1; }
trap 'rm -rf "$_stage" 2>/dev/null || true' EXIT INT TERM

_root="${_stage}/${NAME}"
mkdir -p "${_root}/bin" "${_root}/lib"

cp "${LINUX_DIR}/install.sh" "${_root}/install.sh"
cp "${UNIX_DIR}/bin/afctctl" "${_root}/bin/afctctl"
# Shared Unix libraries plus the Linux-only libraries, flattened into one lib/ directory
# (the runtime afctctl sources them from its own release's flat lib/, so the source split
# is invisible after packaging).
cp "${UNIX_DIR}"/lib/*.sh "${_root}/lib/"
cp "${LINUX_DIR}"/lib/*.sh "${_root}/lib/"
[ -f "${DEPLOY_DIR}/.shellcheckrc" ] && cp "${DEPLOY_DIR}/.shellcheckrc" "${_root}/.shellcheckrc"
cp "${DEPLOY_DIR}/docker-compose.yml" "${_root}/docker-compose.yml"
cp "${DEPLOY_DIR}/.env.production.example" "${_root}/.env.production.example"
printf '%s\n' "$VERSION" > "${_root}/DEPLOY_VERSION"
chmod 0755 "${_root}/install.sh" "${_root}/bin/afctctl" 2>/dev/null || true

mkdir -p "$OUT_DIR"
_tarball="${OUT_DIR}/${NAME}.tar.gz"
# Reproducible archive: the SAME sources must produce the SAME bytes (and therefore the
# same content digest) on every build, so a content-addressed release identity is stable
# and CI can tell a real content change from a rebuild. GNU tar + `gzip -n` give sorted
# entries, a fixed mtime/owner, and no embedded gzip timestamp. busybox tar lacks those
# flags, so it falls back to a plain archive (used only for local, single-build testing).
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

# Deployment manifest: the machine-readable pointer to this bundle (deployment-tool
# version, bundle filename, checksum, bootstrap name). Update detection and self-update read
# this instead of parsing executable shell source. The deployment-tool version is distinct
# from the application image version (which lives in versions.json).
_sha=$(awk '{ print $1; exit }' "${_tarball}.sha256")
[ -n "$_sha" ] || { printf 'ERROR: could not read the bundle checksum\n' >&2; exit 1; }
cat > "${OUT_DIR}/deployment-manifest.json" <<EOF
{
  "schema": "afct-deployment-manifest/v1",
  "deploymentToolVersion": "${VERSION}",
  "bundle": "${NAME}.tar.gz",
  "sha256": "${_sha}",
  "bootstrap": "install.sh"
}
EOF

printf '%s\n' "$_tarball"
