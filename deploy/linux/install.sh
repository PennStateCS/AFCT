#!/bin/sh
# AFCT Linux bootstrap installer.
#
# This is a small, inspectable bootstrap. It downloads ONE verified, versioned Linux
# deployment bundle, installs it under /opt/afct, and hands off to the bundled
# `afctctl install`. Everything else (Docker setup, configuration, deployment, updates,
# diagnostics) lives in the downloaded deployment tooling, not here.
#
#   curl -fsSLO https://github.com/PennStateCS/AFCT/releases/latest/download/install.sh
#   sudo sh install.sh
#
# The bundle and its SHA-256 are published as assets on each AFCT GitHub release. A fork
# or mirror can be pointed at with AFCT_RELEASE_API / AFCT_BUNDLE_URL, and an air-gapped
# install can hand over a pre-downloaded archive with AFCT_BUNDLE_FILE.
#
# Bootstrap-only options (everything else is forwarded verbatim to `afctctl install`):
#   --deploy-version <v>   Install a specific deployment-tool bundle instead of the latest.
#   --bundle-file <path>    Install from a local bundle archive (offline); still verified
#                           against <path>.sha256 when present.
#   --prefix <dir>          Install root (default: /opt/afct).
#   -h, --help              Show this help.

set -eu
umask 077

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
REPO=${AFCT_REPO:-PennStateCS/AFCT}
PREFIX=${AFCT_PREFIX:-/opt/afct}
# Where release assets are resolved from. The API lists the assets on a release; the
# override lets a fork/mirror publish its own bundle. AFCT_BUNDLE_URL skips the API and
# downloads a specific archive directly.
RELEASE_API=${AFCT_RELEASE_API:-https://api.github.com/repos/${REPO}/releases}
BUNDLE_URL=${AFCT_BUNDLE_URL:-}
BUNDLE_SHA_URL=${AFCT_BUNDLE_SHA256_URL:-}
BUNDLE_FILE=${AFCT_BUNDLE_FILE:-}
DEPLOY_VERSION=${AFCT_DEPLOY_VERSION:-}
# The bundle asset is named afct-linux-deploy-<deploy-version>.tar.gz.
ASSET_PREFIX="afct-linux-deploy-"

WORK_DIR=""

log()  { printf '[afct] %s\n' "$*"; }
err()  { printf '[afct] ERROR: %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
}

cleanup() {
  [ -n "$WORK_DIR" ] && rm -rf "$WORK_DIR" 2>/dev/null || true
}
# Clean up partial downloads on success, failure, or interruption.
trap 'cleanup' EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# --------------------------------------------------------------------------- #
# Argument parsing: consume bootstrap-only options, forward the rest to afctctl.
# --------------------------------------------------------------------------- #
_argc=$#
while [ "$_argc" -gt 0 ]; do
  _arg=$1
  shift
  _argc=$((_argc - 1))
  case "$_arg" in
    --deploy-version) [ "$#" -gt 0 ] || die "--deploy-version needs a value."; DEPLOY_VERSION=$1; shift; _argc=$((_argc - 1)) ;;
    --deploy-version=*) DEPLOY_VERSION=${_arg#*=} ;;
    --bundle-file) [ "$#" -gt 0 ] || die "--bundle-file needs a path."; BUNDLE_FILE=$1; shift; _argc=$((_argc - 1)) ;;
    --bundle-file=*) BUNDLE_FILE=${_arg#*=} ;;
    --prefix) [ "$#" -gt 0 ] || die "--prefix needs a directory."; PREFIX=$1; shift; _argc=$((_argc - 1)) ;;
    --prefix=*) PREFIX=${_arg#*=} ;;
    -h|--help) usage; exit 0 ;;
    # Not a bootstrap flag: keep it (in order) to forward to `afctctl install`.
    *) set -- "$@" "$_arg" ;;
  esac
done
# "$@" now holds only the forwarded install arguments, in their original order.

# --------------------------------------------------------------------------- #
# Require an absolute, traversal-free install prefix, and canonicalize it. A relative or
# ../-containing prefix could place releases outside the intended tree; an existing
# symlinked prefix is only followed to a validated absolute target.
# --------------------------------------------------------------------------- #
validate_prefix() {
  case "$PREFIX" in
    /*) ;;
    *) die "the install prefix must be an absolute path (got '${PREFIX}'). Use --prefix /opt/afct." ;;
  esac
  case "$PREFIX" in
    */../*|*/..|../*|*/./*|*/.) die "the install prefix must not contain '.' or '..' path segments (got '${PREFIX}')." ;;
  esac
  # Resolve an existing prefix (which may itself be a symlink) to a real absolute path so
  # releases/ and current are created under it, not through an unexpected link target.
  if [ -e "$PREFIX" ] && command -v realpath >/dev/null 2>&1; then
    _rp=$(realpath "$PREFIX" 2>/dev/null || printf '')
    case "$_rp" in
      /*) PREFIX=$_rp ;;
      *) die "could not resolve the install prefix '${PREFIX}' to an absolute path." ;;
    esac
  fi
}
validate_prefix

# --------------------------------------------------------------------------- #
# Preconditions
# --------------------------------------------------------------------------- #
[ "$(uname -s 2>/dev/null || printf unknown)" = "Linux" ] || {
  err "this bootstrap installs AFCT on Linux only."
  case "$(uname -s 2>/dev/null || printf unknown)" in
    Darwin) err "on macOS, install Docker Desktop and see the AFCT documentation." ;;
  esac
  exit 1
}

[ "$(id -u 2>/dev/null || printf 1)" = "0" ] || \
  die "run this as root, for example: sudo sh install.sh"

# One downloader and the archive tools. Docker itself is handled later by afctctl.
if command -v curl >/dev/null 2>&1; then
  DOWNLOADER=curl
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER=wget
else
  die "curl or wget is required to download the AFCT deployment bundle."
fi
command -v tar >/dev/null 2>&1 || die "tar is required to unpack the AFCT deployment bundle."
command -v gzip >/dev/null 2>&1 || command -v gunzip >/dev/null 2>&1 || \
  die "gzip is required to unpack the AFCT deployment bundle."
if command -v sha256sum >/dev/null 2>&1; then
  SHA_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_TOOL="shasum -a 256"
else
  die "sha256sum (or shasum) is required to verify the deployment bundle."
fi

# --------------------------------------------------------------------------- #
# Download helpers
# --------------------------------------------------------------------------- #
download() {
  # download <url> <dest>. Bounded timeouts + a few retries so a flaky network fails
  # predictably instead of hanging.
  _u=$1
  _d=$2
  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL --connect-timeout 10 --max-time 300 --retry 3 --retry-delay 2 "$_u" -o "$_d"
  else
    wget -q --timeout=30 --tries=3 -O "$_d" "$_u"
  fi
}

# Resolve a bundle asset's download URL from a GitHub release document, which may be a
# single release object (…/releases/latest) or an ARRAY of releases (…/releases). jq is
# preferred; a tolerant line scan is the fallback. Used only to resolve the download URL.

# Latest: the first asset whose name starts with the bundle prefix and ends with the
# suffix. Only used against the single latest release, where one bundle is expected.
resolve_asset_url() {
  _json=$1
  _suffix=$2   # e.g. .tar.gz or .tar.gz.sha256
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg p "$ASSET_PREFIX" --arg s "$_suffix" '
      (if type == "array" then . else [.] end)
      | .[]?.assets[]?
      | select((.name | startswith($p)) and (.name | endswith($s)))
      | .browser_download_url' "$_json" 2>/dev/null | head -n 1
    return 0
  fi
  awk -v p="$ASSET_PREFIX" -v s="$_suffix" '
    {
      while (match($0, /"browser_download_url"[ \t]*:[ \t]*"[^"]*"/)) {
        tok = substr($0, RSTART, RLENGTH)
        $0 = substr($0, RSTART + RLENGTH)
        sub(/^"browser_download_url"[ \t]*:[ \t]*"/, "", tok)
        sub(/"$/, "", tok)
        n = split(tok, parts, "/")
        base = parts[n]
        if (index(base, p) == 1 && substr(base, length(base) - length(s) + 1) == s) {
          print tok
          exit
        }
      }
    }
  ' "$_json"
}

# A specific asset by EXACT filename, so afct-linux-deploy-2.2.0.tar.gz can never match
# afct-linux-deploy-2.2.0-rc1.tar.gz or afct-linux-deploy-2.2.10.tar.gz. Handles the array
# response used when searching across releases for a requested --deploy-version.
resolve_exact_asset() {
  _json=$1
  _name=$2
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg n "$_name" '
      (if type == "array" then . else [.] end)
      | .[]?.assets[]? | select(.name == $n) | .browser_download_url' \
      "$_json" 2>/dev/null | head -n 1
    return 0
  fi
  awk -v n="$_name" '
    {
      while (match($0, /"browser_download_url"[ \t]*:[ \t]*"[^"]*"/)) {
        tok = substr($0, RSTART, RLENGTH)
        $0 = substr($0, RSTART + RLENGTH)
        sub(/^"browser_download_url"[ \t]*:[ \t]*"/, "", tok)
        sub(/"$/, "", tok)
        m = split(tok, a, "/")
        if (a[m] == n) { print tok; exit }
      }
    }
  ' "$_json"
}

# Number of releases in a listing (array length, or 1 for a single object), used to stop
# paginating once the last page is reached. jq when present; 0 otherwise (single-page).
release_count() {
  if command -v jq >/dev/null 2>&1; then
    jq 'if type == "array" then length else 1 end' "$1" 2>/dev/null || printf '0'
    return 0
  fi
  printf '0'
}

# --------------------------------------------------------------------------- #
# Resolve, download, and verify the bundle into $WORK_DIR/bundle.tar.gz
# --------------------------------------------------------------------------- #
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/afct-bootstrap.XXXXXX") || die "could not create a temporary directory."
_archive="${WORK_DIR}/bundle.tar.gz"
_checksum="${WORK_DIR}/bundle.tar.gz.sha256"

_unverified_local=""
if [ -n "$BUNDLE_FILE" ]; then
  # Offline / air-gapped: use a local archive. A checksum is REQUIRED by default; an
  # unverified local bundle only proceeds when the operator explicitly opts in.
  [ -f "$BUNDLE_FILE" ] || die "bundle file not found: ${BUNDLE_FILE}"
  cp "$BUNDLE_FILE" "$_archive" || die "could not read the bundle file."
  if [ -f "${BUNDLE_FILE}.sha256" ]; then
    cp "${BUNDLE_FILE}.sha256" "$_checksum" || die "could not read the bundle checksum."
  elif [ -n "${AFCT_BUNDLE_SHA256:-}" ]; then
    # An explicitly supplied trusted checksum value.
    printf '%s  %s\n' "$AFCT_BUNDLE_SHA256" "$(basename "$BUNDLE_FILE")" > "$_checksum"
  elif [ "${AFCT_ALLOW_UNVERIFIED_LOCAL_BUNDLE:-}" = "1" ]; then
    _unverified_local=1
    err "WARNING: installing a LOCAL bundle WITHOUT checksum verification (AFCT_ALLOW_UNVERIFIED_LOCAL_BUNDLE=1)."
    err "WARNING: this bypasses the SHA-256 checksum verification, which detects corruption and a mismatched or wrong asset. The bundle is NOT verified; only its archive safety and internal version consistency are still checked."
    _checksum=""
  else
    die "no ${BUNDLE_FILE}.sha256 alongside the local bundle. Provide the checksum file, set AFCT_BUNDLE_SHA256=<sha256>, or set AFCT_ALLOW_UNVERIFIED_LOCAL_BUNDLE=1 to install without verification."
  fi
else
  if [ -z "$BUNDLE_URL" ] && [ -n "$DEPLOY_VERSION" ]; then
    # A specific deployment-tool version: the bundle carries the version in its exact file
    # name, so match it exactly and search releases with bounded pagination. The default
    # cap is documented in the not-found message so a large history is never silently
    # truncated (raise it with AFCT_RELEASE_MAX_PAGES if needed).
    _name_tar="afct-linux-deploy-${DEPLOY_VERSION}.tar.gz"
    _name_sha="${_name_tar}.sha256"
    _max_pages=${AFCT_RELEASE_MAX_PAGES:-5}
    case "$_max_pages" in ''|*[!0-9]*) _max_pages=5 ;; esac
    log "resolving AFCT Linux deployment bundle ${DEPLOY_VERSION} from ${REPO}..."
    _page=1
    while [ "$_page" -le "$_max_pages" ]; do
      _rel="${WORK_DIR}/release-${_page}.json"
      download "${RELEASE_API}?per_page=100&page=${_page}" "$_rel" || die "could not query releases from ${RELEASE_API}."
      BUNDLE_URL=$(resolve_exact_asset "$_rel" "$_name_tar")
      if [ -n "$BUNDLE_URL" ]; then
        BUNDLE_SHA_URL=$(resolve_exact_asset "$_rel" "$_name_sha")
        break
      fi
      _cnt=$(release_count "$_rel")
      case "$_cnt" in ''|*[!0-9]*) _cnt=0 ;; esac
      [ "$_cnt" -lt 100 ] && break     # a short page is the last page
      _page=$((_page + 1))
    done
    [ -n "$BUNDLE_URL" ] || \
      die "deployment bundle ${DEPLOY_VERSION} (${_name_tar}) was not found in the most recent $((_max_pages * 100)) releases of ${REPO}. Check the version, or raise AFCT_RELEASE_MAX_PAGES / set AFCT_BUNDLE_URL."
  elif [ -z "$BUNDLE_URL" ]; then
    # The latest release. One bundle is expected, so match by prefix + suffix.
    log "resolving the latest AFCT Linux deployment bundle from ${REPO}..."
    _rel="${WORK_DIR}/release.json"
    download "${RELEASE_API}/latest" "$_rel" || die "could not query the latest release from ${RELEASE_API}."
    BUNDLE_URL=$(resolve_asset_url "$_rel" ".tar.gz" || true)
    BUNDLE_SHA_URL=$(resolve_asset_url "$_rel" ".tar.gz.sha256" || true)
    [ -n "$BUNDLE_URL" ] || die "no AFCT Linux deployment bundle asset was found on the latest release. If this is a fork, set AFCT_BUNDLE_URL."
  fi

  log "downloading the deployment bundle..."
  download "$BUNDLE_URL" "$_archive" || die "could not download the deployment bundle from ${BUNDLE_URL}."
  if [ -n "$BUNDLE_SHA_URL" ]; then
    download "$BUNDLE_SHA_URL" "$_checksum" || die "could not download the bundle checksum."
  elif [ -n "${AFCT_BUNDLE_URL:-}" ]; then
    # Direct URL override without a checksum URL: try the conventional sibling name.
    download "${BUNDLE_URL}.sha256" "$_checksum" 2>/dev/null || _checksum=""
  else
    _checksum=""
  fi
fi

# Verify BEFORE anything from the archive is read or executed.
_digest=""
if [ -n "$_checksum" ] && [ -s "$_checksum" ]; then
  log "verifying the bundle checksum..."
  _expected=$(awk '{ print $1; exit }' "$_checksum")
  case "$_expected" in
    ''|*[!0-9a-fA-F]*) die "the bundle checksum file is malformed." ;;
  esac
  _actual=$($SHA_TOOL "$_archive" | awk '{ print $1; exit }')
  [ "$_expected" = "$_actual" ] || \
    die "bundle checksum mismatch (expected ${_expected}, got ${_actual}); refusing to install."
  log "checksum verified."
  _digest=$_actual
else
  # No checksum available. Only a LOCAL bundle under the explicit unverified override may
  # proceed; a remote download without a checksum is always refused.
  [ -n "$_unverified_local" ] || die "no checksum was available for the bundle; refusing to install."
fi

# The verified content digest gives each release a content-addressed identity, so a
# release directory is never modified in place: the same bundle always maps to the same
# directory, and different content maps to a different one.
[ -n "$_digest" ] || _digest=$($SHA_TOOL "$_archive" | awk '{ print $1; exit }')
case "$_digest" in
  ''|*[!0-9a-fA-F]*) die "could not compute the bundle content digest." ;;
esac
_digest_prefix=$(printf '%s' "$_digest" | cut -c1-12)

# --------------------------------------------------------------------------- #
# Inspect the archive for path-traversal and unsafe entries BEFORE extracting.
# --------------------------------------------------------------------------- #
log "inspecting the bundle contents..."
_listing="${WORK_DIR}/listing.txt"
tar -tzf "$_archive" > "$_listing" 2>/dev/null || die "the bundle archive could not be read."
[ -s "$_listing" ] || die "the bundle archive is empty."
while IFS= read -r _entry; do
  case "$_entry" in
    /*|*/../*|../*|*/..) die "the bundle contains an unsafe path (${_entry}); refusing to extract." ;;
  esac
done < "$_listing"
# Reject symlinks/hardlinks/devices: only regular files and directories are expected.
if tar -tvzf "$_archive" 2>/dev/null | awk '{ print substr($1,1,1) }' | grep -q '[^d-]'; then
  die "the bundle contains a symbolic link, device, or other special file; refusing to extract."
fi

# --------------------------------------------------------------------------- #
# Extract into a staging directory, validate, then publish as a versioned release.
# --------------------------------------------------------------------------- #
_stage="${WORK_DIR}/stage"
mkdir -p "$_stage"
tar -xzf "$_archive" -C "$_stage" || die "could not extract the deployment bundle."

# The bundle may be a single top-level directory or a flat set of files; normalize to
# the directory that actually contains bin/afctctl.
_root="$_stage"
if [ ! -f "${_root}/bin/afctctl" ]; then
  for _d in "$_stage"/*/; do
    [ -f "${_d}bin/afctctl" ] && { _root=${_d%/}; break; }
  done
fi
[ -f "${_root}/bin/afctctl" ] || die "the bundle is missing bin/afctctl."
[ -d "${_root}/lib" ] || die "the bundle is missing its lib directory."
[ -f "${_root}/docker-compose.yml" ] || die "the bundle is missing docker-compose.yml."

# Version agreement: the bundle's DEPLOY_VERSION, its bundled afctctl INSTALLER_VERSION, any
# requested --deploy-version, and the bundle filename (when it follows the standard name)
# must all name the SAME deployment-tool version. This protects against a fork, mirror,
# stale cache, or operator-supplied asset that pairs mismatched pieces, and does not trust a
# version merely because CI usually builds releases correctly.
_dv=$(sed -n '1p' "${_root}/DEPLOY_VERSION" 2>/dev/null | tr -dc '0-9A-Za-z._-')
_iv=$(sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "${_root}/bin/afctctl" 2>/dev/null | head -n1)
[ -n "$_dv" ] || die "the bundle is missing a usable DEPLOY_VERSION."
[ -n "$_iv" ] || die "the bundle's afctctl is missing INSTALLER_VERSION."
[ "$_dv" = "$_iv" ] || die "bundle version metadata disagrees: DEPLOY_VERSION=${_dv} but afctctl INSTALLER_VERSION=${_iv}; refusing to install."
if [ -n "$DEPLOY_VERSION" ] && [ "$DEPLOY_VERSION" != "$_dv" ]; then
  die "requested deployment version ${DEPLOY_VERSION}, but the bundle contains ${_dv}."
fi
# When the source filename carries the version (an asset or a standard local name), it must
# match the internal version exactly.
_fname=""
[ -n "$BUNDLE_FILE" ] && _fname=$(basename "$BUNDLE_FILE")
[ -z "$_fname" ] && [ -n "$BUNDLE_URL" ] && _fname=$(basename "${BUNDLE_URL%%\?*}")
case "$_fname" in
  afct-linux-deploy-*.tar.gz)
    _fver=${_fname#afct-linux-deploy-}
    _fver=${_fver%.tar.gz}
    [ "$_fver" = "$_dv" ] || die "bundle filename ${_fname} does not match its DEPLOY_VERSION ${_dv}."
    ;;
esac
_ver=$_dv

# Structural syntax checks on the shell we are about to make active.
for _sh in "${_root}/bin/afctctl" "${_root}/lib/"*.sh; do
  [ -f "$_sh" ] || continue
  sh -n "$_sh" 2>/dev/null || die "a bundled script failed its syntax check (${_sh##*/}); refusing to install."
done

_releases="${PREFIX}/releases"
# Content-addressed release identity: <deploy-version>-<digest-prefix>. The same bundle
# always maps to the same directory (so a repeat install is a no-op), and different
# content maps to a different directory (so a release directory is never modified).
_release_id="${_ver}-${_digest_prefix}"
_target="${_releases}/${_release_id}"
mkdir -p "$_releases" "${PREFIX}/bin" "${PREFIX}/shared"

_current="${PREFIX}/current"

# Capture a valid previous target (inside our releases and not this release) so a failed
# switch can roll the pointer back to a known-good directory.
_prev_target=""
if [ -L "$_current" ]; then
  _old=$(readlink "$_current" 2>/dev/null || true)
  case "$_old" in
    "$_releases"/*)
      [ -d "$_old" ] && [ "$_old" != "$_target" ] && _prev_target=$_old
      ;;
    *) log "replacing an unexpected ${_current} symlink target (${_old})." ;;
  esac
elif [ -e "$_current" ]; then
  die "${_current} exists and is not a symlink; move it aside and re-run."
fi

# A version's bytes are fixed: refuse to install a different bundle under a version that is
# already installed with other content. Bump the deployment-tool version instead. Quarantine
# leftovers (.corrupt/.incoming) never count as a real installed release.
for _existing in "${_releases}/${_ver}-"*; do
  [ -d "$_existing" ] || continue
  case "$_existing" in *.corrupt.*|*.incoming.*) continue ;; esac
  [ "$_existing" = "$_target" ] && continue
  die "deployment version ${_ver} is already installed with different content (${_existing##*/}). Bump the deployment-tool version rather than republishing ${_ver}."
done

# A content-addressed release is only treated as an idempotent no-op when it is COMPLETE:
# the expected structure exists, afctctl parses, every library module is present, and the
# installed version metadata agrees with this bundle. A truncated or corrupt directory (for
# example an interrupted earlier extract) must never be trusted or switched to.
_release_dir_complete() {
  _d=$1
  [ -f "${_d}/bin/afctctl" ] || return 1
  [ -d "${_d}/lib" ] || return 1
  [ -f "${_d}/docker-compose.yml" ] || return 1
  [ -f "${_d}/DEPLOY_VERSION" ] || return 1
  sh -n "${_d}/bin/afctctl" 2>/dev/null || return 1
  for _m in output common validation prompts environment platform docker compose \
            service-user migration manifest deployment update diagnostics doctor; do
    [ -f "${_d}/lib/${_m}.sh" ] || return 1
  done
  _edv=$(sed -n '1p' "${_d}/DEPLOY_VERSION" 2>/dev/null | tr -dc '0-9A-Za-z._-')
  _eiv=$(sed -n 's/^INSTALLER_VERSION="\(.*\)"/\1/p' "${_d}/bin/afctctl" 2>/dev/null | head -n1)
  [ -n "$_edv" ] && [ "$_edv" = "$_eiv" ] && [ "$_edv" = "$_ver" ] || return 1
  return 0
}

# Publish immutably. The target name does not exist yet when the content is new (different
# content => different name), so this never overwrites an existing release, and in
# particular never the directory `current` points at.
_need_publish=1
if [ -d "$_target" ]; then
  if _release_dir_complete "$_target"; then
    log "deployment tooling ${_ver} (${_digest_prefix}) is already installed; not re-extracting."
    _need_publish=0
  else
    _quarantine="${_target}.corrupt.$$"
    err "the existing release ${_release_id} is incomplete or corrupt; quarantining it to ${_quarantine} and reinstalling."
    mv "$_target" "$_quarantine" 2>/dev/null || \
      die "could not quarantine the incomplete release at ${_target}. Move it aside manually and re-run."
  fi
fi
if [ "$_need_publish" = "1" ]; then
  _incoming="${_target}.incoming.$$"
  rm -rf "$_incoming" 2>/dev/null || true
  cp -R "$_root" "$_incoming" || die "could not stage the new release."
  chmod +x "${_incoming}/bin/afctctl" 2>/dev/null || true
  mv "$_incoming" "$_target" || { rm -rf "$_incoming" 2>/dev/null || true; die "could not publish the new release."; }
fi

# Switch the active-release symlink in place, unless it already points here. Use `ln -sfn`,
# NOT a rename: a `mv` of a new symlink over an existing symlink-to-directory moves the new
# link INTO the pointed-at directory (true on both GNU coreutils and busybox) rather than
# replacing it, which would silently leave `current` unchanged. acquire_lock serialises
# afctctl, so no reader observes the sub-millisecond swap. Never delete the previous target
# during the switch; retention below keeps it for rollback.
_already_current="false"
[ "$(readlink "$_current" 2>/dev/null || true)" = "$_target" ] && _already_current="true"
if [ "$_already_current" != "true" ]; then
  ln -sfn "$_target" "$_current" 2>/dev/null \
    || { rm -f "$_current" 2>/dev/null; ln -s "$_target" "$_current"; } \
    || die "could not switch the active release."
fi

# Convenience entry point on PATH. A tiny wrapper (not a symlink) so it always resolves
# through the current release even if PATH caching is odd.
_wrapper="/usr/local/bin/afctctl"
if [ -d /usr/local/bin ] || mkdir -p /usr/local/bin 2>/dev/null; then
  if {
       printf '#!/bin/sh\n'
       printf '# AFCT control command. Resolves the active release under %s.\n' "$PREFIX"
       printf 'exec "%s/current/bin/afctctl" "$@"\n' "$PREFIX"
     } > "${_wrapper}.new.$$" 2>/dev/null &&
     chmod 0755 "${_wrapper}.new.$$" 2>/dev/null &&
     mv "${_wrapper}.new.$$" "$_wrapper" 2>/dev/null
  then
    :
  else
    rm -f "${_wrapper}.new.$$" 2>/dev/null || true
    log "could not install ${_wrapper}; run AFCT with ${PREFIX}/current/bin/afctctl."
  fi
fi

# Keep the current release plus a bounded number of previous ones for rollback; remove
# older releases. Never removes the active or the immediately-previous target.
prune_old_releases() {
  _keep=${AFCT_KEEP_RELEASES:-2}
  case "$_keep" in ''|*[!0-9]*) _keep=2 ;; esac
  _cur=$(readlink "$_current" 2>/dev/null || true)

  # Whitespace-safe: iterate the glob (which never word-splits on spaces in the prefix)
  # and record "<mtime><TAB><path>" per release, then sort newest-first. No `ls` parsing
  # and no GNU-only flags: stat has a BSD form (-f) and a GNU/busybox form (-c).
  _tab=$(printf '\t')
  _plist=$(mktemp "${TMPDIR:-/tmp}/afct-prune.XXXXXX" 2>/dev/null || printf '')
  [ -n "$_plist" ] || return 0
  for _d in "${_releases}"/*/; do
    [ -d "$_d" ] || continue
    _d=${_d%/}
    _mt=$(stat -c '%Y' "$_d" 2>/dev/null || stat -f '%m' "$_d" 2>/dev/null || printf '0')
    printf '%s%s%s\n' "$_mt" "$_tab" "$_d" >> "$_plist"
  done

  _i=0
  sort -rn "$_plist" | while IFS="$_tab" read -r _mt _d; do
    [ -n "$_d" ] || continue
    _i=$((_i + 1))
    [ "$_i" -le "$_keep" ] && continue
    [ "$_d" = "$_cur" ] && continue
    [ "$_d" = "$_prev_target" ] && continue
    rm -rf "$_d" 2>/dev/null || true
  done
  rm -f "$_plist" 2>/dev/null || true
}

log "installed the AFCT deployment tooling ${_ver} at ${_target}."

# Record an unverified-override install in the installer log, so an operator can later see
# that this release went in without checksum verification. Never described as "verified".
if [ -n "$_unverified_local" ]; then
  mkdir -p "${PREFIX}/shared" 2>/dev/null || true
  printf '%s WARNING: installed UNVERIFIED local bundle %s as release %s (AFCT_ALLOW_UNVERIFIED_LOCAL_BUNDLE=1)\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')" "$BUNDLE_FILE" "$_release_id" \
    >> "${PREFIX}/shared/install.log" 2>/dev/null || true
fi

if [ -n "${AFCT_SWITCH_ONLY:-}" ]; then
  # Deployment-tool self-update: the active release is now the new bundle. Validate that
  # the new afctctl at least loads; on failure roll the pointer back to the previous
  # release and remove the broken one. Do NOT run `afctctl install`.
  if "${PREFIX}/current/bin/afctctl" version >/dev/null 2>&1; then
    prune_old_releases
    log "the deployment tooling is now ${_ver}."
    cleanup
    trap - EXIT INT TERM
    exit 0
  fi
  err "the new deployment tooling failed validation; rolling back."
  if [ -n "$_prev_target" ] && [ -d "$_prev_target" ]; then
    # Same in-place symlink swap as above (a rename would move into the target directory).
    ln -sfn "$_prev_target" "$_current" 2>/dev/null \
      || { rm -f "$_current" 2>/dev/null; ln -s "$_prev_target" "$_current"; }
    rm -rf "$_target" 2>/dev/null || true
    die "rolled back to the previous deployment tooling."
  fi
  die "no previous release to roll back to; the deployment tooling may be broken."
fi

prune_old_releases
cleanup
trap - EXIT INT TERM

# Hand off to the bundled controller for Docker setup, configuration, and deployment.
# The original install arguments are forwarded verbatim.
exec "${PREFIX}/current/bin/afctctl" install "$@"
