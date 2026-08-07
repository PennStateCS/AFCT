#!/bin/sh
# Support-archive collection for afctctl, with configuration-key and exact-value secret
# redaction.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (ENV_FILE,
# COMPOSE_FILE, LOG_FILE, PULL_OUTPUT, DOCKER_INSTALL_OUTPUT, INSTALLER_VERSION,
# DIAG_PREFIX, DIAG_WORK, DIAG_IN_PROGRESS, SHARED_DIR).
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

diagnostics_output_dir() {
  for _candidate in "$SHARED_DIR" "${HOME:-}" "${TMPDIR:-/tmp}"; do
    [ -n "$_candidate" ] || continue
    [ -d "$_candidate" ] || continue
    [ -w "$_candidate" ] || continue
    printf '%s' "$_candidate"
    return 0
  done
  return 1
}

redact_env_file() {
  _source=$1
  _destination=$2

  awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { print; next }
    /=/ {
      key = $0
      sub(/=.*/, "", key)
      clean = key
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", clean)
      upper = toupper(clean)
      if (upper ~ /PASSWORD|SECRET|TOKEN|PRIVATE|CREDENTIAL|DATABASE_URL|API_KEY/) {
        print key "=***REDACTED***"
      } else {
        print
      }
      next
    }
    { print }
  ' "$_source" > "$_destination" 2>/dev/null || true
}

redact_exact_secrets_in_tree() {
  _root=$1
  [ -d "$_root" ] || return 0
  [ -f "$ENV_FILE" ] || return 0

  _secret_file=$(mktemp "${TMPDIR:-/tmp}/afct-secrets.XXXXXX") || return 0
  chmod 600 "$_secret_file" 2>/dev/null || true
  for _key in POSTGRES_PASSWORD DATABASE_URL NEXTAUTH_SECRET ADMIN_PASSWORD; do
    _value=$(read_env_value "$_key" "$ENV_FILE")
    [ -n "$_value" ] && printf '%s\n' "$_value" >> "$_secret_file"
  done

  find "$_root" -type f 2>/dev/null | while IFS= read -r _file; do
    [ -f "$_file" ] || continue
    _tmp="${_file}.redacting.$$"
    cp "$_file" "$_tmp" 2>/dev/null || continue
    while IFS= read -r _secret; do
      [ -n "$_secret" ] || continue
      # Literal (not regex) replacement: a secret may contain regex metacharacters.
      if ! awk -v s="$_secret" -v r='***REDACTED***' '
        {
          line = $0; out = ""
          while ((p = index(line, s)) > 0) {
            out = out substr(line, 1, p - 1) r
            line = substr(line, p + length(s))
          }
          print out line
        }' "$_tmp" > "${_tmp}.next" 2>/dev/null; then
        # Never ship a file we could not fully redact: drop it AND its source.
        rm -f "$_tmp" "${_tmp}.next" "$_file"
        continue 2
      fi
      mv "${_tmp}.next" "$_tmp"
    done < "$_secret_file"
    mv "$_tmp" "$_file" 2>/dev/null || rm -f "$_tmp"
  done
  rm -f "$_secret_file" 2>/dev/null || true
}

collect_diagnostics() {
  _reason=${1:-manual}
  DIAG_IN_PROGRESS="true"

  _timestamp=$(date +%Y%m%d-%H%M%S 2>/dev/null || printf 'now')
  DIAG_WORK=$(mktemp -d "${TMPDIR:-/tmp}/${DIAG_PREFIX}.XXXXXX") || {
    error "could not create a temporary diagnostics directory."
    return 1
  }
  _bundle_name="${DIAG_PREFIX}-${_timestamp}-$$"
  _bundle_dir="${DIAG_WORK}/${_bundle_name}"
  _output_dir=$(diagnostics_output_dir) || {
    error "no writable directory is available for the diagnostics archive."
    return 1
  }
  mkdir -p "$_bundle_dir" || return 1

  info "collecting AFCT diagnostics..."

  {
    printf 'AFCT deployment tool version: %s\n' "$INSTALLER_VERSION"
    printf 'Collection reason: %s\n' "$_reason"
    printf 'Collected: %s\n\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')"
    uname -a 2>/dev/null || true
    printf '\n'
    platform_os_identity
  } > "$_bundle_dir/system.txt" 2>&1

  if resolve_docker_access_soft; then
    docker_cmd version > "$_bundle_dir/docker-version.txt" 2>&1 || true
    docker_cmd info > "$_bundle_dir/docker-info.txt" 2>&1 || true

    if [ -n "$COMPOSE_KIND" ] && [ -f "$COMPOSE_FILE" ]; then
      compose_project ps > "$_bundle_dir/compose-ps.txt" 2>&1 || true
      compose_project logs --no-color --tail 400 > "$_bundle_dir/compose-logs.txt" 2>&1 || true
      # The app container's state (health-probe log, exit code, OOM flag): the evidence
      # behind a failed health check. .State only, never .Config, whose Env carries every
      # secret the container was started with.
      _diag_app_id=$(compose_project ps -q "$APP_SERVICE" 2>/dev/null | head -n 1 || true)
      if [ -n "$_diag_app_id" ]; then
        docker_cmd inspect -f '{{json .State}}' "$_diag_app_id" > "$_bundle_dir/app-state.json" 2>&1 || true
      fi
    fi
  else
    printf 'Docker was unavailable or its daemon could not be reached without prompting.\n' \
      > "$_bundle_dir/docker-unavailable.txt"
  fi

  [ -f "$COMPOSE_FILE" ] && cp "$COMPOSE_FILE" "$_bundle_dir/docker-compose.yml" 2>/dev/null || true
  [ -f "$LOG_FILE" ] && cp "$LOG_FILE" "$_bundle_dir/install.log" 2>/dev/null || true
  [ -f "$ENV_FILE" ] && redact_env_file "$ENV_FILE" "$_bundle_dir/env.redacted.txt"
  [ -n "${PULL_OUTPUT:-}" ] && [ -f "$PULL_OUTPUT" ] && \
    cp "$PULL_OUTPUT" "$_bundle_dir/image-pull.txt" 2>/dev/null || true
  [ -n "${DOCKER_INSTALL_OUTPUT:-}" ] && [ -f "$DOCKER_INSTALL_OUTPUT" ] && \
    cp "$DOCKER_INSTALL_OUTPUT" "$_bundle_dir/docker-install.txt" 2>/dev/null || true

  {
    printf 'Deployment tool version: %s\n' "$INSTALLER_VERSION"
    printf 'Files included:\n'
    find "$_bundle_dir" -maxdepth 1 -type f -print 2>/dev/null | sed 's#^.*/#  - #' || true
    printf '\nKnown configuration values were redacted by key and by exact value.\n'
  } > "$_bundle_dir/manifest.txt"

  redact_exact_secrets_in_tree "$_bundle_dir"

  _archive=""
  if command -v zip >/dev/null 2>&1; then
    _archive="${_output_dir}/${_bundle_name}.zip"
    if ! (cd "$DIAG_WORK" && zip -qr "$_archive" "$_bundle_name"); then
      _archive=""
    fi
  fi

  if [ -z "$_archive" ]; then
    _archive="${_output_dir}/${_bundle_name}.tar.gz"
    if ! tar -C "$DIAG_WORK" -czf "$_archive" "$_bundle_name"; then
      rm -rf "$DIAG_WORK" 2>/dev/null || true
      DIAG_WORK=""
      error "could not create the diagnostics archive."
      return 1
    fi
  fi

  rm -rf "$DIAG_WORK" 2>/dev/null || true
  DIAG_WORK=""

  success "Diagnostics saved to ${_archive}"
  warn "known configuration secrets were redacted, but logs and Compose files can still contain sensitive information. Review the archive before sharing it."
  DIAG_IN_PROGRESS="false"
  return 0
}
