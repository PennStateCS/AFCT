#!/bin/sh
# Input validation, secret generation, and read-only system checks for afctctl.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl
# (APP_URL_IN, INSTALL_MIN_FREE_MB, UPDATE_MIN_FREE_MB, SCRIPT_DIR/RELEASE_DIR) and
# calls docker_cmd (docker.sh) from free_disk_mb.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

require_value() {
  [ -n "$1" ] || die "$2"
}

is_positive_integer() {
  case "$1" in
    ''|*[!0-9]*|0) return 1 ;;
    *) return 0 ;;
  esac
}

is_email() {
  case "$1" in
    *[[:space:]]*|*@*@*) return 1 ;;
    ?*@?*.?*) return 0 ;;
    *) return 1 ;;
  esac
}

normalize_app_url() {
  _url=$1

  case "$_url" in
    *[[:space:]]*) return 1 ;;
    http://*) _scheme="http" ;;
    https://*) _scheme="https" ;;
    *) return 1 ;;
  esac

  _authority=${_url#*://}
  while [ "${_authority%/}" != "$_authority" ]; do
    _authority=${_authority%/}
  done

  [ -n "$_authority" ] || return 1
  case "$_authority" in
    */*|*\?*|*\#*|*@*) return 1 ;;
  esac

  case "$_authority" in
    \[*\]*) _host=$_authority ;;
    *) _host=${_authority%%:*} ;;
  esac
  [ -n "$_host" ] || return 1

  printf '%s://%s' "$_scheme" "$_authority"
}

warn_for_app_url() {
  _url=$1
  _without_scheme=${_url#*://}
  _hostport=${_without_scheme%%/*}
  _host=${_hostport%%:*}

  case "$_url" in
    https://*) ;;
    http://localhost*|http://127.0.0.1*|http://\[::1\]*) ;;
    *) warn "the public URL is not HTTPS. Authentication cookies and redirects may not work safely in production." ;;
  esac

  if printf '%s' "$_host" | grep -Eq '^[0-9]+(\.[0-9]+){3}$'; then
    warn "the public URL uses a bare IPv4 address. A hostname with a matching TLS certificate is strongly recommended."
  fi
}

# The AFCT stack always terminates TLS at nginx and redirects :80 -> :443, so it is only
# ever reached over HTTPS. An http:// public URL would produce a cookie-scheme mismatch
# that lets login succeed but 401s authenticated requests. Upgrade http:// to https://
# (operating on the global APP_URL_IN), keeping an explicit localhost as-is for testing.
enforce_https_app_url() {
  case "$APP_URL_IN" in
    http://localhost|http://localhost:*|http://localhost/*) return 0 ;;
    http://127.0.0.1|http://127.0.0.1:*|http://127.0.0.1/*) return 0 ;;
    http://\[::1\]|http://\[::1\]:*|http://\[::1\]/*) return 0 ;;
    http://*)
      APP_URL_IN="https://${APP_URL_IN#http://}"
      info "the AFCT stack serves HTTPS; using ${APP_URL_IN} as the public URL."
      ;;
  esac
}

is_strong_password() {
  _password=$1
  [ "${#_password}" -ge 8 ] && [ "${#_password}" -le 72 ] || return 1
  printf '%s' "$_password" | grep -q '[A-Z]' || return 1
  printf '%s' "$_password" | grep -q '[a-z]' || return 1
  printf '%s' "$_password" | grep -q '[0-9]' || return 1
  printf '%s' "$_password" | grep -q '[^A-Za-z0-9]' || return 1
  return 0
}

# Values are written unquoted into the env file, which both legacy docker-compose v1 and
# modern Compose v2 read literally to end-of-line. Reject inputs that would be
# reinterpreted: quotes/backslashes, line breaks, tabs, leading/trailing spaces (v2
# trims), and a space before '#' (v2 treats it as an inline comment).
is_env_value_safe() {
  _cr=$(printf '\r')
  _tab=$(printf '\t')
  case "$1" in
    *"'"*) return 1 ;;
    *'"'*) return 1 ;;
    *\\*) return 1 ;;
    *"$_cr"*) return 1 ;;
    *"$_tab"*) return 1 ;;
  esac
  case "$1" in
    *"
"*) return 1 ;;
  esac
  case "$1" in
    ' '*|*' ') return 1 ;;
    *' #'*) return 1 ;;
  esac
  return 0
}

gen_secret() {
  _secret=""
  if command -v openssl >/dev/null 2>&1; then
    _secret=$(openssl rand -hex 32 2>/dev/null || true)
  elif [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    _secret=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | \
      od -An -tx1 2>/dev/null | tr -d ' \n' || true)
  fi
  [ "${#_secret}" -ge 48 ] || return 1
  printf '%.48s' "$_secret"
}

gen_admin_password() {
  _core=$(gen_secret) || return 1
  printf '%sAa1!' "$_core"
}

port_in_use() {
  _port=$1

  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v port="$_port" '
      NR > 1 {
        address = $4
        sub(/.*:/, "", address)
        if (address == port) found = 1
      }
      END { exit(found ? 0 : 1) }
    '
    return $?
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$_port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

# Free MB on the filesystem backing Docker's image store, or nothing if it cannot be
# measured (callers treat that as "unknown", never as "full").
free_disk_mb() {
  command -v df >/dev/null 2>&1 || return 0
  # Prefer Docker's actual data-root: a custom `data-root`, or /var/lib/docker on its
  # own mount, can be a different filesystem than the conventional path. Best-effort and
  # never prompts; falls back to the conventional path, then the deploy directory.
  _df_path=$(docker_cmd info -f '{{.DockerRootDir}}' 2>/dev/null || true)
  [ -n "$_df_path" ] && [ -d "$_df_path" ] || _df_path=/var/lib/docker
  [ -d "$_df_path" ] || _df_path=${STATE_DIR:-$RELEASE_DIR}
  _free=$(df -Pm "$_df_path" 2>/dev/null | awk 'NR == 2 { print $4 }')
  case "$_free" in
    ''|*[!0-9]*) return 0 ;;
  esac
  printf '%s' "$_free"
}

check_disk_space() {
  _available=$(free_disk_mb)
  [ -n "$_available" ] || return 0
  if [ "$_available" -lt "$INSTALL_MIN_FREE_MB" ]; then
    warn "less than approximately $((INSTALL_MIN_FREE_MB / 1024)) GB is free. The AFCT images need roughly that much to download and unpack."
  fi
}

# Hard gate before an update pulls. The app image is ~4.7GB and Docker holds the
# compressed download and the unpacked layers at once; without this the failure mode is
# a pull that dies at 98% with "no space left on device", then a rollback whose log says
# only "failed".
require_update_disk_space() {
  _available=$(free_disk_mb)
  [ -n "$_available" ] || return 0   # cannot measure: do not block the update
  if [ "$_available" -lt "$UPDATE_MIN_FREE_MB" ]; then
    die "only ${_available}MB is free, but about ${UPDATE_MIN_FREE_MB}MB is needed to download the new images. Reclaim space and re-run, for example: docker image prune -a -f"
  fi
}

check_sensitive_permissions() {
  _file=$1
  [ -f "$_file" ] || return 0
  if command -v stat >/dev/null 2>&1; then
    _mode=$(stat -c '%a' "$_file" 2>/dev/null || stat -f '%Lp' "$_file" 2>/dev/null || printf '')
    case "$_mode" in
      ''|*[!0-9]*) return 0 ;;
    esac
    _group=$(((_mode / 10) % 10))
    _other=$((_mode % 10))
    if [ "$_group" -ne 0 ] || [ "$_other" -ne 0 ]; then
      warn "${_file} is readable or writable by group/other users (mode ${_mode}); expected 600."
      return 1
    fi
  fi
  return 0
}

# 0 = confirmed synchronized; 1 = confirmed NOT synchronized; 2 = could not determine
# (no timedatectl, or an indeterminate state) - callers must not report this as "ok".
check_clock_sync() {
  command -v timedatectl >/dev/null 2>&1 || return 2
  _sync=$(timedatectl show -p NTPSynchronized --value 2>/dev/null || printf '')
  case "$_sync" in
    yes) return 0 ;;
    no) warn "the system clock is not synchronized. Incorrect time can break TLS and authentication."; return 1 ;;
  esac
  return 2
}
