#!/bin/sh
# Environment-file helpers and deploy-file ownership for afctctl.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (ENV_FILE,
# ENV_EXAMPLE, SERVICE_MODE, SERVICE_USER, INSTALLER_VERSION, and the *_IN config values
# for write_environment_file). Ownership helpers are no-ops when not running as root.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

# When the installer is run via sudo, files it writes are root-owned. A later NON-root
# run then can't read .env.production. Hand ownership of the given paths back to the
# invoking user. No-op when not run under sudo, or when genuinely root (no SUDO_USER).
restore_sudo_owner() {
  [ "$(id -u 2>/dev/null || echo 1)" = "0" ] || return 0
  [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] || return 0
  for _p in "$@"; do
    [ -e "$_p" ] && chown "$SUDO_USER" "$_p" 2>/dev/null || true
  done
}

# Hand a freshly written deploy file to the account that operates the stack: the
# dedicated service account in service mode, otherwise the sudo-invoking user. No-op when
# not running as root.
own_deploy_path() {
  if [ "${SERVICE_MODE:-false}" = "true" ]; then
    [ "$(id -u 2>/dev/null || echo 1)" = "0" ] || return 0
    for _p in "$@"; do
      [ -e "$_p" ] && chown "$SERVICE_USER:$(service_user_group)" "$_p" 2>/dev/null \
        || { [ -e "$_p" ] && chown "$SERVICE_USER" "$_p" 2>/dev/null; } || true
    done
    return 0
  fi
  restore_sudo_owner "$@"
}

env_file_complete() {
  _file=$1
  [ -s "$_file" ] || return 1

  for _key in POSTGRES_PASSWORD DATABASE_URL NEXTAUTH_SECRET NEXTAUTH_URL; do
    grep -qE "^[[:space:]]*${_key}=.+" "$_file" 2>/dev/null || return 1
  done
  return 0
}

read_env_value() {
  _key=$1
  _file=$2
  [ -f "$_file" ] || return 0

  _raw=$(awk -v key="$_key" '
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      if (index(line, key "=") == 1) {
        print substr(line, length(key) + 2)
        exit
      }
    }
  ' "$_file" 2>/dev/null || true)

  case "$_raw" in
    \'*)
      case "$_raw" in *\') _raw=${_raw#\'}; _raw=${_raw%\'} ;; esac
      ;;
    \"*)
      case "$_raw" in *\") _raw=${_raw#\"}; _raw=${_raw%\"} ;; esac
      ;;
  esac

  printf '%s' "$_raw"
}

# Set or replace a single unmanaged KEY=VALUE line in the env file, in place and
# atomically, preserving everything else. Used for AFCT_UPDATER_ENABLED / AFCT_APP_TAG.
# Guarantee the secret-encryption key exists, generating one if it does not.
#
# Called from the paths that deploy WITHOUT rewriting the environment file: an ordinary
# `update`, and an install that finds a complete env file and is not reconfiguring. Those
# paths are how an existing deployment reaches a version that needs the key, and without this
# it would come up with no key at all and fail the first time an admin saved a mail or
# sign-in credential.
#
# Never replaces an existing key. Doing so would make every already-encrypted secret
# unreadable, which is the one unrecoverable mistake available here.
ensure_secret_key() {
  [ -f "$ENV_FILE" ] || return 0
  _existing_key=$(read_env_value AFCT_SECRET_KEY "$ENV_FILE")
  [ -z "$_existing_key" ] || return 0

  _new_key=$(gen_secret) || die "could not generate a secret-encryption key."
  set_env_flag AFCT_SECRET_KEY "$_new_key"
  info "generated a secret-encryption key; it protects stored settings such as mail and sign-in credentials. Keep ${ENV_FILE} with your backups."
}

set_env_flag() {
  _key=$1
  _val=$2
  [ -f "$ENV_FILE" ] || die "${ENV_FILE} not found. Run the installer first."
  _tmp=$(mktemp "${ENV_FILE}.tmp.XXXXXX" 2>/dev/null) || die "could not create a temporary file next to ${ENV_FILE}."
  if grep -qE "^${_key}=" "$ENV_FILE" 2>/dev/null; then
    awk -v k="$_key" -v v="$_val" '$0 ~ ("^" k "=") { print k "=" v; next } { print }' \
      "$ENV_FILE" > "$_tmp" || { rm -f "$_tmp"; die "could not update ${ENV_FILE}."; }
  else
    { cat "$ENV_FILE" && printf '%s=%s\n' "$_key" "$_val"; } > "$_tmp" \
      || { rm -f "$_tmp"; die "could not update ${ENV_FILE}."; }
  fi
  chmod 600 "$_tmp" 2>/dev/null || true
  mv "$_tmp" "$ENV_FILE" || { rm -f "$_tmp"; die "could not replace ${ENV_FILE}."; }
  own_deploy_path "$ENV_FILE"
}

write_env_assignment() {
  _key=$1
  _value=$2
  is_env_value_safe "$_value" || die "${_key} contains characters that cannot be stored safely in ${ENV_FILE} (line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#')."
  printf '%s=%s\n' "$_key" "$_value"
}

backup_env_file() {
  [ -f "$ENV_FILE" ] || return 0
  _stamp=$(date +%Y%m%d-%H%M%S 2>/dev/null || printf 'previous')
  _backup="${ENV_FILE}.backup.${_stamp}.$$"
  cp "$ENV_FILE" "$_backup" || die "could not back up ${ENV_FILE}."
  chmod 600 "$_backup" 2>/dev/null || true
  own_deploy_path "$_backup"
  info "saved the previous configuration as ${_backup}."
}

write_environment_file() {
  _base_file=""
  if [ -f "$ENV_FILE" ]; then
    _base_file=$ENV_FILE
  elif [ -f "$ENV_EXAMPLE" ]; then
    _base_file=$ENV_EXAMPLE
  fi

  TMP_ENV=$(mktemp "${ENV_FILE}.tmp.XXXXXX" 2>/dev/null) || \
    die "could not create a temporary configuration file next to ${ENV_FILE}."

  if [ -n "$_base_file" ]; then
    # Preserve comments and application-specific settings, but remove every key managed
    # by this installer so each appears exactly once in the final file.
    awk '
      BEGIN {
        in_managed_block = 0
        managed["NODE_ENV"] = 1
        managed["POSTGRES_PASSWORD"] = 1
        managed["DATABASE_URL"] = 1
        managed["ADMIN_EMAIL"] = 1
        managed["ADMIN_PASSWORD"] = 1
        managed["NEXTAUTH_SECRET"] = 1
        managed["AFCT_SECRET_KEY"] = 1
        managed["NEXTAUTH_URL"] = 1
        managed["AUTH_TRUST_HOST"] = 1
      }
      /^# BEGIN AFCT INSTALLER MANAGED SETTINGS$/ { in_managed_block = 1; next }
      /^# END AFCT INSTALLER MANAGED SETTINGS$/ { in_managed_block = 0; next }
      in_managed_block { next }
      {
        line = $0
        sub(/^[[:space:]]*/, "", line)
        key = line
        sub(/[=:].*/, "", key)
        gsub(/[[:space:]]+$/, "", key)
        if (key in managed) next
        print
      }
    ' "$_base_file" > "$TMP_ENV"
  else
    : > "$TMP_ENV"
  fi

  {
    printf '\n# BEGIN AFCT INSTALLER MANAGED SETTINGS\n'
    printf '# Managed by AFCT afctctl %s\n' "$INSTALLER_VERSION"
    printf '# Updated: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')"
    printf '# Keep this file private. Reconfiguration preserves infrastructure secrets.\n'
    printf '# Change an existing administrator password from inside AFCT, not here.\n'
    write_env_assignment NODE_ENV production
    write_env_assignment POSTGRES_PASSWORD "$POSTGRES_PASSWORD_IN"
    write_env_assignment DATABASE_URL "$DATABASE_URL_IN"
    write_env_assignment ADMIN_EMAIL "$ADMIN_EMAIL_IN"
    write_env_assignment ADMIN_PASSWORD "$ADMIN_PASSWORD_IN"
    write_env_assignment NEXTAUTH_SECRET "$NEXTAUTH_SECRET_IN"
    write_env_assignment AFCT_SECRET_KEY "$AFCT_SECRET_KEY_IN"
    write_env_assignment NEXTAUTH_URL "$APP_URL_IN"
    write_env_assignment AUTH_TRUST_HOST true
    printf '# END AFCT INSTALLER MANAGED SETTINGS\n'
  } >> "$TMP_ENV"

  chmod 600 "$TMP_ENV" 2>/dev/null || true
  mv "$TMP_ENV" "$ENV_FILE" || die "could not replace ${ENV_FILE}."
  TMP_ENV=""
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  own_deploy_path "$ENV_FILE"
}
