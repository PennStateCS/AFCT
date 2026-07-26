#!/bin/sh
# Assemble the versioned AFCT Linux deployment bundle.
#
# The bundle is built from a single source of truth: the Linux tooling in deploy/linux/
# plus the SHARED Compose file and env template in deploy/ (the same files the Windows
# installer uses). There are therefore no duplicated compose/env files to keep in sync;
# this script (and the CI check that runs it) is the generation + verification mechanism.
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
OUT_DIR=${1:-${DEPLOY_DIR}/dist}

VERSION=$(sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "${LINUX_DIR}/bin/afctctl" | head -n 1)
[ -n "$VERSION" ] || { printf 'ERROR: could not read INSTALLER_VERSION from bin/afctctl\n' >&2; exit 1; }

NAME="afct-linux-deploy-${VERSION}"

# Required shared sources.
for _f in "${DEPLOY_DIR}/docker-compose.yml" "${DEPLOY_DIR}/.env.production.example"; do
  [ -f "$_f" ] || { printf 'ERROR: missing shared source file: %s\n' "$_f" >&2; exit 1; }
done

_stage=$(mktemp -d "${TMPDIR:-/tmp}/afct-bundle.XXXXXX") || { printf 'ERROR: mktemp failed\n' >&2; exit 1; }
trap 'rm -rf "$_stage" 2>/dev/null || true' EXIT INT TERM

_root="${_stage}/${NAME}"
mkdir -p "${_root}/bin" "${_root}/lib"

cp "${LINUX_DIR}/install.sh" "${_root}/install.sh"
cp "${LINUX_DIR}/bin/afctctl" "${_root}/bin/afctctl"
cp "${LINUX_DIR}"/lib/*.sh "${_root}/lib/"
[ -f "${LINUX_DIR}/.shellcheckrc" ] && cp "${LINUX_DIR}/.shellcheckrc" "${_root}/.shellcheckrc"
cp "${DEPLOY_DIR}/docker-compose.yml" "${_root}/docker-compose.yml"
cp "${DEPLOY_DIR}/.env.production.example" "${_root}/.env.production.example"
printf '%s\n' "$VERSION" > "${_root}/DEPLOY_VERSION"
chmod 0755 "${_root}/install.sh" "${_root}/bin/afctctl" 2>/dev/null || true

mkdir -p "$OUT_DIR"
_tarball="${OUT_DIR}/${NAME}.tar.gz"
# Deterministic ordering; the archive contains exactly one top-level directory.
tar -C "$_stage" -czf "$_tarball" "$NAME"

( cd "$OUT_DIR" && \
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${NAME}.tar.gz"
  else
    shasum -a 256 "${NAME}.tar.gz"
  fi ) > "${_tarball}.sha256"

printf '%s\n' "$_tarball"
