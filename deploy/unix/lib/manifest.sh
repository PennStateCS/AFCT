#!/bin/sh
# Deployment-tool release metadata (deployment-manifest.json).
#
# The manifest is the authoritative, machine-readable description of the newest deployment
# TOOLING release: its version, bundle filename, and the bundle's SHA-256. Update detection
# and self-update read it instead of parsing executable shell source (which never carried a
# usable version), so they are reliable when jq is present or absent.
#
# It is deliberately distinct from the APPLICATION release manifest (versions.json), which
# lists app image tags. This file only describes the deployment tooling.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (REPO,
# SHARED_DIR) and calls fetch_url / own_deploy_path.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

deployment_manifest_url() {
  printf '%s' "${AFCT_DEPLOY_MANIFEST_URL:-https://github.com/${REPO}/releases/latest/download/$(platform_manifest_asset)}"
}

# Base URL the manifest's bundle/checksum assets are downloaded from (the latest release's
# asset directory by default; a fork/mirror or the test harness overrides it).
deployment_asset_base() {
  printf '%s' "${AFCT_DEPLOY_ASSET_BASE:-https://github.com/${REPO}/releases/latest/download}"
}

manifest_cache_file() {
  printf '%s/deployment-manifest.json' "$SHARED_DIR"
}

# Read one string field from a manifest file. jq when available; a tolerant scan otherwise.
manifest_field() {
  _field=$1
  _file=$2
  [ -f "$_file" ] || return 0
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$_field" '.[$k] // empty' "$_file" 2>/dev/null
    return 0
  fi
  awk -v k="$_field" '
    {
      pat = "\"" k "\"[ \t]*:[ \t]*\"[^\"]*\""
      if (match($0, pat)) {
        tok = substr($0, RSTART, RLENGTH)
        sub(/^"[^"]*"[ \t]*:[ \t]*"/, "", tok)
        sub(/"$/, "", tok)
        print tok
        exit
      }
    }' "$_file"
}

# The bundle filename a manifest MUST name for a given deployment-tool version. The bundle
# is never an arbitrary .tar.gz; it is exactly this name, so a mismatch is rejected. The
# platform picks the family prefix (afct-linux-deploy- / afct-macos-deploy-) so a Linux
# host never accepts a macOS bundle or vice versa.
manifest_expected_bundle() {
  printf '%s%s.tar.gz' "$(platform_bundle_prefix)" "$1"
}

# Validate the manifest before anything privileged trusts it. This drives self-update, so
# it is strict:
#   * jq is REQUIRED. A loose regex scan cannot prove a document is well-formed JSON, and a
#     self-update must never act on weakly parsed metadata. Without jq this returns non-zero
#     and callers simply skip the update (normal operations continue).
#   * the schema field must be exactly "afct-deployment-manifest/v1".
#   * deploymentToolVersion, bundle, and sha256 must be present and well-formed.
#   * the bundle filename must be exactly afct-linux-deploy-<version>.tar.gz (no path
#     separators, no other name).
manifest_valid() {
  _file=$1
  [ -s "$_file" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  jq -e . "$_file" >/dev/null 2>&1 || return 1

  _schema=$(manifest_field schema "$_file")
  [ "$_schema" = "afct-deployment-manifest/v1" ] || return 1

  _v=$(manifest_field deploymentToolVersion "$_file")
  _b=$(manifest_field bundle "$_file")
  _s=$(manifest_field sha256 "$_file")
  [ -n "$_v" ] && [ -n "$_b" ] && [ -n "$_s" ] || return 1
  case "$_v" in ''|*[!0-9A-Za-z._-]*) return 1 ;; esac
  case "$_s" in ''|*[!0-9a-fA-F]*) return 1 ;; esac
  [ "${#_s}" -eq 64 ] || return 1
  case "$_b" in *"/"*|*"\\"*) return 1 ;; esac
  [ "$_b" = "$(manifest_expected_bundle "$_v")" ] || return 1
  return 0
}

# Fetch the manifest into <dest>, validate it, and cache a last-known-good copy. On a
# network failure or a malformed document, fall back to the cached copy when it is valid.
# Returns 0 with a usable manifest in <dest>; non-zero otherwise. Callers treat a non-zero
# result as "no update information", never as fatal, so a flaky network never blocks work.
fetch_deployment_manifest() {
  _dest=$1
  _cache=$(manifest_cache_file)
  if fetch_url "$(deployment_manifest_url)" "$_dest" 2>/dev/null && manifest_valid "$_dest"; then
    if cp "$_dest" "${_cache}.tmp.$$" 2>/dev/null; then
      chmod 600 "${_cache}.tmp.$$" 2>/dev/null || true
      mv "${_cache}.tmp.$$" "$_cache" 2>/dev/null && own_deploy_path "$_cache" || rm -f "${_cache}.tmp.$$" 2>/dev/null || true
    fi
    return 0
  fi
  if [ -f "$_cache" ] && manifest_valid "$_cache"; then
    cp "$_cache" "$_dest" 2>/dev/null || return 1
    return 0
  fi
  return 1
}
