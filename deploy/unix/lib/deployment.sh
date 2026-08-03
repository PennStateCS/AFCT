#!/bin/sh
# Preflight, configuration, deployment, health checks, and the day-to-day operational
# commands for afctctl.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (COMPOSE_FILE,
# ENV_FILE, ENV_EXAMPLE, SERVICE_MODE, SERVICE_USER, PREFIX, HEALTH_*, APP_SERVICE,
# RECONFIGURING, FORCE_RECONFIGURE, and the *_IN config values).
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

# Where the images come from. Only used to tell an operator which host to check when a
# pull fails; the Compose file is what actually decides where images are fetched.
REGISTRY_HOST=${AFCT_REGISTRY_HOST:-ghcr.io}

preflight() {
  step "System checks"

  [ -f "$COMPOSE_FILE" ] || die "the Compose file was not found: ${COMPOSE_FILE}"
  [ -f "$ENV_EXAMPLE" ] || warn "the environment template was not found; the installer will create a minimal production configuration."

  is_positive_integer "$HEALTH_TIMEOUT" || die "AFCT_HEALTH_TIMEOUT must be a positive integer."
  is_positive_integer "$HEALTH_INTERVAL" || die "AFCT_HEALTH_INTERVAL must be a positive integer."

  maybe_install_docker
  resolve_docker_access || true
  ensure_compose
  ensure_docker_boot

  # On Docker Desktop (macOS), confirm the daemon can bind-mount our install directories
  # before starting the stack, so a prefix outside Docker's file-sharing list fails here
  # with a clear message instead of a confusing mount error at `up`. No-op on Linux, and
  # skipped when Docker is mocked for tests (AFCT_SKIP_BIND_MOUNT_CHECK=1).
  platform_check_bind_mounts

  _docker_version=$(docker_cmd version --format '{{.Server.Version}}' 2>/dev/null || printf 'unknown')
  _compose_version=$(compose_raw version --short 2>/dev/null || compose_raw version 2>/dev/null | head -n 1 || printf 'unknown')
  success "Docker ${_docker_version} is available."
  success "Docker Compose ${_compose_version} is available."

  if ! env_file_complete "$ENV_FILE"; then
    for _port in 80 443; do
      if port_in_use "$_port"; then
        warn "TCP port ${_port} is already in use. The AFCT web service may be unable to bind it."
      fi
    done
  fi

  check_disk_space
  check_clock_sync || true
  check_sensitive_permissions "$ENV_FILE" || true
  check_sensitive_permissions "$LOG_FILE" || true
}

http_health_responding() {
  command -v curl >/dev/null 2>&1 || return 1
  curl -kfsS --max-time 10 "https://localhost${HEALTH_PATH}" >/dev/null 2>&1 || \
    curl -kfsS --max-time 10 "http://localhost${HEALTH_PATH}" >/dev/null 2>&1
}

# Best-effort evidence dump for a failed deploy: the app container's most recent health
# probe results and its last log lines, so the failure message says WHY, not just that it
# happened. Never fails the caller.
explain_app_failure() {
  _fail_id=${1:-}
  [ -n "$_fail_id" ] || return 0
  _probes=$(docker_cmd inspect \
    -f '{{if .State.Health}}{{range .State.Health.Log}}exit={{.ExitCode}} {{.Output}}{{printf "\n"}}{{end}}{{end}}' \
    "$_fail_id" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n 3 || true)
  if [ -n "$_probes" ]; then
    error "recent health probe results:"
    printf '%s\n' "$_probes" | while IFS= read -r _probe_line; do
      error "  ${_probe_line}"
    done
  fi
  _app_tail=$(docker_cmd logs --tail 20 "$_fail_id" 2>&1 | tail -n 20 || true)
  if [ -n "$_app_tail" ]; then
    error "last ${APP_SERVICE} log lines:"
    printf '%s\n' "$_app_tail" | while IFS= read -r _log_line; do
      error "  ${_log_line}"
    done
  fi
  return 0
}

wait_for_health() {
  info "waiting for the application health check..."

  _elapsed=0
  # A single restart can happen during a normal recreate, but repeated restarts mean a
  # crash loop that will never become healthy, so fail fast instead of waiting the whole
  # timeout.
  _restarting=0
  _seen_container="false"
  while [ "$_elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    _app_id=$(compose_project ps -q "$APP_SERVICE" 2>/dev/null || true)

    if [ -n "$_app_id" ]; then
      _seen_container="true"
      _state=$(docker_cmd inspect \
        -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
        "$_app_id" 2>/dev/null || printf 'missing|none')
      _container_state=${_state%%|*}
      _health_state=${_state#*|}

      case "${_container_state}|${_health_state}" in
        running\|healthy)
          success "The AFCT application is healthy."
          if http_health_responding; then
            success "The web service is responding at ${HEALTH_PATH}."
          else
            warn "the container is healthy, but the local web endpoint did not respond yet."
          fi
          return 0
          ;;
        running\|unhealthy)
          explain_app_failure "$_app_id"
          die "the application container reported an unhealthy state."
          ;;
        exited\|*|dead\|*)
          explain_app_failure "$_app_id"
          die "the application container stopped before becoming healthy."
          ;;
        restarting\|*)
          _restarting=$((_restarting + 1))
          if [ "$_restarting" -ge 3 ]; then
            explain_app_failure "$_app_id"
            die "the ${APP_SERVICE} container keeps restarting (crash loop) instead of becoming healthy. Check the logs: afctctl logs"
          fi
          ;;
        running\|none)
          die "the ${APP_SERVICE} service has no Docker health check configured."
          ;;
      esac
    fi

    sleep "$HEALTH_INTERVAL"
    _elapsed=$((_elapsed + HEALTH_INTERVAL))
  done

  if [ "$_seen_container" = "false" ]; then
    die "the ${APP_SERVICE} container was never created, so the application did not become healthy within ${HEALTH_TIMEOUT} seconds. Check 'afctctl status'."
  fi
  explain_app_failure "$_app_id"
  die "the application did not become healthy within ${HEALTH_TIMEOUT} seconds."
}

# Can THIS MACHINE open a connection to the image registry? Any HTTP reply counts,
# including the 401 ghcr.io returns for an unauthenticated request: the question is
# whether the packets get there, not whether we are allowed in.
#
# Deliberately separate from whether DOCKER can reach it. Docker Desktop runs its own
# virtual machine with its own network, and the interesting failure is when the two
# disagree.
registry_reachable_from_host() {
  command -v curl >/dev/null 2>&1 || return 2
  curl -sS -o /dev/null --connect-timeout 10 --max-time 20 "https://${REGISTRY_HOST}/v2/" \
    >/dev/null 2>&1
}

# Turn a failed `compose pull` into a sentence naming the likely cause. Reads the captured
# output, because Docker already says exactly what went wrong and the old message
# ("check the network and registry authentication") threw that away and guessed at two
# causes at once.
explain_pull_failure() {
  _out=${1:-}
  _text=""
  [ -n "$_out" ] && [ -s "$_out" ] && _text=$(cat "$_out" 2>/dev/null || printf '')

  case "$_text" in
    *"unauthorized"*|*"authentication required"*|*"denied:"*)
      printf '%s' "the registry refused the credentials. Run 'docker login ghcr.io' if these images are private."
      return
      ;;
    *"manifest unknown"*|*"not found"*)
      printf '%s' "the registry has no image for that version. Check AFCT_APP_TAG against the published releases."
      return
      ;;
    *"no space left on device"*)
      printf '%s' "the disk filled up while downloading. Free space and try again."
      return
      ;;
  esac

  # Everything else that reaches here is a connection problem. Which side is broken
  # changes the fix completely, so say which.
  if registry_reachable_from_host; then
    printf '%s' "this machine can reach ${REGISTRY_HOST}, but Docker cannot, so this is Docker's own networking rather than your internet connection. Quit Docker Desktop completely and reopen it, disconnect any VPN, and if your network requires a proxy set it under Settings, Resources, Proxies."
  else
    printf '%s' "this machine cannot reach ${REGISTRY_HOST} either. Check the internet connection, a VPN, or a firewall between here and the registry."
  fi
}

pull_images() {
  info "downloading AFCT container images..."
  PULL_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/afct-pull.XXXXXX") || \
    die "could not create temporary pull output."

  if [ -t 1 ]; then
    # `tee` so an interactive operator still watches the download AND we keep a copy.
    # Without the copy there is nothing to diagnose from on the one run that matters.
    if compose_project pull 2>&1 | tee "$PULL_OUTPUT"; then _pull_status=0; else _pull_status=$?; fi
  else
    if [ "$COMPOSE_KIND" = "v2" ]; then
      if compose_project pull --quiet > "$PULL_OUTPUT" 2>&1; then _pull_status=0; else _pull_status=$?; fi
    else
      if compose_project pull > "$PULL_OUTPUT" 2>&1; then _pull_status=0; else _pull_status=$?; fi
    fi
    cat "$PULL_OUTPUT" >> "$LOG_FILE" 2>/dev/null || true
  fi

  if [ "$_pull_status" -ne 0 ]; then
    # Only re-print the output when it has not already been on screen.
    if [ ! -t 1 ]; then
      [ -s "$PULL_OUTPUT" ] && cat "$PULL_OUTPUT" >&2 2>/dev/null || true
    fi
    _why=$(explain_pull_failure "$PULL_OUTPUT")
    die "container images could not be downloaded: ${_why}"
  fi

  rm -f "$PULL_OUTPUT" 2>/dev/null || true
  PULL_OUTPUT=""
  success "Container images downloaded."
}

start_stack() {
  info "starting the AFCT stack..."
  if [ "${LOG_ENABLED:-false}" = "true" ]; then
    if ! compose_project up -d >> "$LOG_FILE" 2>&1; then
      die "the AFCT stack could not be started. Review ${LOG_FILE}."
    fi
  else
    if ! compose_project up -d; then
      die "the AFCT stack could not be started."
    fi
  fi
}

deploy_stack() {
  validate_compose
  pull_images
  start_stack
  wait_for_health
}

restart_stack() {
  validate_compose
  start_stack
  wait_for_health
}

show_deployed_versions() {
  info "deployment tool version: ${INSTALLER_VERSION}"
  resolve_docker_access_soft || return 0
  [ -n "$COMPOSE_KIND" ] || return 0
  [ -f "$COMPOSE_FILE" ] || return 0
  _app_id=$(compose_project ps -q "$APP_SERVICE" 2>/dev/null || true)
  [ -n "$_app_id" ] || return 0
  _image=$(docker_cmd inspect -f '{{.Config.Image}}' "$_app_id" 2>/dev/null || true)
  _image_id=$(docker_cmd inspect -f '{{.Image}}' "$_app_id" 2>/dev/null || true)
  [ -n "$_image" ] && info "application image: ${_image}"
  [ -n "$_image_id" ] && info "application image ID: ${_image_id}"
}

configure_new_install() {
  step "AFCT configuration"

  _default_url="https://$(hostname 2>/dev/null || printf 'localhost')"
  _requested_url=${APP_URL:-}
  if [ -z "$_requested_url" ]; then
    _requested_url=$(prompt_default "Public URL" "$_default_url")
  fi
  APP_URL_IN=$(normalize_app_url "$_requested_url") || \
    die "APP_URL must be a valid http:// or https:// origin without spaces, paths, queries, or fragments."
  enforce_https_app_url
  is_env_value_safe "$APP_URL_IN" || die "APP_URL contains unsupported characters."
  warn_for_app_url "$APP_URL_IN"

  ADMIN_EMAIL_IN=${ADMIN_EMAIL:-}
  if [ -z "$ADMIN_EMAIL_IN" ]; then
    ADMIN_EMAIL_IN=$(prompt_required "Administrator email") || \
      die "ADMIN_EMAIL is required. Set it as an environment variable or run interactively."
  fi
  is_email "$ADMIN_EMAIL_IN" || die "the administrator email does not appear valid: ${ADMIN_EMAIL_IN}"
  is_env_value_safe "$ADMIN_EMAIL_IN" || die "ADMIN_EMAIL contains unsupported characters."

  _provided_password=$(read_password_source)
  _password_generated="false"

  if [ -n "$_provided_password" ]; then
    ADMIN_PASSWORD_IN=$_provided_password
  elif ! can_prompt; then
    if [ "$NON_INTERACTIVE" = "true" ]; then
      die "ADMIN_PASSWORD or ADMIN_PASSWORD_FILE is required in non-interactive mode."
    fi
    ADMIN_PASSWORD_IN=$(gen_admin_password) || die "could not generate a secure administrator password."
    _password_generated="true"
  else
    _choice=$(prompt_default "Set the administrator password yourself (t) or generate one (g)?" "g")
    case "$_choice" in
      g|G|generate)
        ADMIN_PASSWORD_IN=$(gen_admin_password) || die "could not generate a secure administrator password."
        _password_generated="true"
        ;;
      *)
        while :; do
          ADMIN_PASSWORD_IN=$(prompt_secret "Administrator password") || die "could not read the password."
          if ! is_strong_password "$ADMIN_PASSWORD_IN"; then
            warn "the password must be 8-72 characters and include uppercase, lowercase, a number, and a special character."
            continue
          fi
          if ! is_env_value_safe "$ADMIN_PASSWORD_IN"; then
            warn "the password cannot contain line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#'."
            continue
          fi
          _confirmation=$(prompt_secret "Confirm administrator password") || die "could not read the password confirmation."
          if [ "$ADMIN_PASSWORD_IN" = "$_confirmation" ]; then
            break
          fi
          warn "the passwords did not match."
        done
        ;;
    esac
  fi

  is_strong_password "$ADMIN_PASSWORD_IN" || \
    die "the administrator password must be 8-72 characters and include uppercase, lowercase, a number, and a special character."
  is_env_value_safe "$ADMIN_PASSWORD_IN" || \
    die "the administrator password cannot contain line breaks, quotes, backslashes, tabs, leading or trailing spaces, or a space before '#'."

  POSTGRES_PASSWORD_IN=$(gen_secret) || die "could not generate a PostgreSQL password."
  NEXTAUTH_SECRET_IN=$(gen_secret) || die "could not generate an authentication secret."
  DATABASE_URL_IN="postgresql://afct_user:${POSTGRES_PASSWORD_IN}@postgres:5432/afct"
  ADMIN_PASSWORD_GENERATED=$_password_generated
}

configure_existing_install() {
  step "Reconfiguration"

  _existing_url=$(read_env_value NEXTAUTH_URL "$ENV_FILE")
  _existing_email=$(read_env_value ADMIN_EMAIL "$ENV_FILE")
  _existing_password=$(read_env_value ADMIN_PASSWORD "$ENV_FILE")

  _default_url=${_existing_url:-"https://$(hostname 2>/dev/null || printf 'localhost')"}
  _requested_url=${APP_URL:-}
  if [ -z "$_requested_url" ]; then
    _requested_url=$(prompt_default "Public URL" "$_default_url")
  fi
  APP_URL_IN=$(normalize_app_url "$_requested_url") || \
    die "APP_URL must be a valid http:// or https:// origin without spaces, paths, queries, or fragments."
  enforce_https_app_url
  is_env_value_safe "$APP_URL_IN" || die "APP_URL contains unsupported characters."
  warn_for_app_url "$APP_URL_IN"

  ADMIN_EMAIL_IN=${ADMIN_EMAIL:-$_existing_email}
  [ -n "$ADMIN_EMAIL_IN" ] || die "ADMIN_EMAIL is missing from the existing configuration."
  is_email "$ADMIN_EMAIL_IN" || die "the administrator email does not appear valid: ${ADMIN_EMAIL_IN}"

  _provided_password=$(read_password_source)
  if [ -n "$_provided_password" ]; then
    ADMIN_PASSWORD_IN=$_provided_password
    warn "updating ADMIN_PASSWORD only changes the bootstrap setting; it does not change an already-created AFCT account password."
  else
    ADMIN_PASSWORD_IN=$_existing_password
  fi
  [ -n "$ADMIN_PASSWORD_IN" ] || die "ADMIN_PASSWORD is missing from the existing configuration."
  is_strong_password "$ADMIN_PASSWORD_IN" || \
    warn "the saved administrator bootstrap password does not meet the current strength policy; keeping it unchanged (it only affects first-run seeding)."
  is_env_value_safe "$ADMIN_PASSWORD_IN" || die "the saved administrator password contains characters this installer cannot rewrite safely; edit ${ENV_FILE} manually."

  POSTGRES_PASSWORD_IN=$(read_env_value POSTGRES_PASSWORD "$ENV_FILE")
  DATABASE_URL_IN=$(read_env_value DATABASE_URL "$ENV_FILE")
  NEXTAUTH_SECRET_IN=$(read_env_value NEXTAUTH_SECRET "$ENV_FILE")

  require_value "$POSTGRES_PASSWORD_IN" "POSTGRES_PASSWORD is missing from ${ENV_FILE}."
  require_value "$DATABASE_URL_IN" "DATABASE_URL is missing from ${ENV_FILE}."
  require_value "$NEXTAUTH_SECRET_IN" "NEXTAUTH_SECRET is missing from ${ENV_FILE}."

  if [ -n "${POSTGRES_PASSWORD:-}${DATABASE_URL:-}${NEXTAUTH_SECRET:-}" ]; then
    warn "exported infrastructure credentials were ignored during reconfiguration to avoid breaking the existing database or invalidating sessions."
  fi

  ADMIN_PASSWORD_GENERATED="false"
}

review_configuration() {
  step "Review"
  info "Public URL:        ${APP_URL_IN}"
  info "Administrator:     ${ADMIN_EMAIL_IN}"
  info "Compose file:      ${COMPOSE_FILE}"
  info "Environment file:  ${ENV_FILE}"

  if [ "$RECONFIGURING" = "true" ]; then
    info "Database and authentication secrets will be preserved."
  fi

  if can_prompt && [ "$ASSUME_YES" != "true" ]; then
    confirm "Continue with this configuration?" "y" || die "installation cancelled."
  fi
}

print_completion() {
  heading "AFCT Dashboard is ready"
  info "Open:          ${APP_URL_IN:-$(read_env_value NEXTAUTH_URL "$ENV_FILE")}"
  info "Administrator: ${ADMIN_EMAIL_IN:-$(read_env_value ADMIN_EMAIL "$ENV_FILE")}"

  if [ "${ADMIN_PASSWORD_GENERATED:-false}" = "true" ]; then
    show_secret ""
    show_secret "Generated administrator password: ${ADMIN_PASSWORD_IN}"
    show_secret "Save this password now. It is intentionally not written to the log."
  fi

  info ""
  info "Manage this deployment with afctctl:"
  info "  sudo afctctl status"
  info "  sudo afctctl doctor"
  info "  sudo afctctl logs"
  info "  sudo afctctl update"
  info "  sudo afctctl diagnostics"
  if [ "$SERVICE_MODE" = "true" ]; then
    info ""
    info "Running under the '${SERVICE_USER}' service account in ${PREFIX}."
  fi
  info ""
  info "A self-signed certificate may trigger a browser warning until a trusted certificate is configured."
}

do_install() {
  DIAG_ON_EXIT="false"
  # Decide the service-account mode BEFORE creating any account. No relocation/re-exec: the
  # bootstrap already installed under /opt/afct.
  preserve_or_setup_service_account
  acquire_lock
  preflight
  # Pin the project name from the running container / existing data volumes so a redeploy
  # reuses the same data instead of orphaning the volumes.
  resolve_and_persist_project_name

  if existing_data_without_config; then
    die "existing AFCT data volumes were detected, but ${ENV_FILE} is missing or incomplete. Restore a protected configuration backup with 'afctctl recover' instead of generating new database credentials."
  fi

  RECONFIGURING="false"
  _existing_complete="false"
  if [ -f "$ENV_FILE" ] && env_file_complete "$ENV_FILE"; then
    _existing_complete="true"
  fi

  if [ "$_existing_complete" = "true" ] && [ "$FORCE_RECONFIGURE" != "true" ]; then
    if can_prompt; then
      existing_install_menu
      if [ "$RECONFIGURING" != "true" ]; then
        info "using the existing ${ENV_FILE}."
        step "Deploy"
        DIAG_ON_EXIT="true"
        deploy_stack
        print_completion
        DIAG_ON_EXIT="false"
        maybe_enable_updater_at_install
        return 0
      fi
    else
      info "using the existing ${ENV_FILE}. Pass --reconfigure to replace managed settings."
      step "Deploy"
      DIAG_ON_EXIT="true"
      deploy_stack
      print_completion
      DIAG_ON_EXIT="false"
      maybe_enable_updater_at_install
      return 0
    fi
  elif [ "$_existing_complete" = "true" ]; then
    RECONFIGURING="true"
  elif [ -f "$ENV_FILE" ]; then
    warn "${ENV_FILE} is incomplete and will be rebuilt after a backup is created."
  fi

  if [ "$RECONFIGURING" = "true" ]; then
    configure_existing_install
  else
    configure_new_install
  fi

  review_configuration
  backup_env_file
  write_environment_file
  success "Configuration written to ${ENV_FILE}."

  if [ "$RECONFIGURING" != "true" ]; then
    pin_release_tag_on_fresh_install
  fi

  step "Deploy"
  DIAG_ON_EXIT="true"
  deploy_stack
  print_completion
  DIAG_ON_EXIT="false"
  maybe_enable_updater_at_install
}

prepare_existing_stack() {
  [ -f "$COMPOSE_FILE" ] || die "the Compose file was not found: ${COMPOSE_FILE}"
  [ -f "$ENV_FILE" ] || die "${ENV_FILE} was not found. Run the installer first."
  resolve_docker_access || die "Docker Compose is not available. Install it and rerun."
}

show_status() {
  prepare_existing_stack
  compose_project ps

  _app_id=$(compose_project ps -q "$APP_SERVICE" 2>/dev/null || true)
  if [ -z "$_app_id" ]; then
    warn "the ${APP_SERVICE} container is not running."
    return 1
  fi

  _state=$(docker_cmd inspect \
    -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$_app_id" 2>/dev/null || printf 'unknown|unknown')
  info "application state: ${_state%%|*}"
  info "application health: ${_state#*|}"
}

show_logs() {
  prepare_existing_stack
  info "following ${APP_SERVICE} logs; press Ctrl+C to stop..."
  compose_project logs -f --tail 200 "$APP_SERVICE"
}

do_restart() {
  acquire_lock
  prepare_existing_stack
  DIAG_ON_EXIT="true"
  info "recreating the AFCT stack..."
  restart_stack
  success "AFCT restart completed."
  DIAG_ON_EXIT="false"
}

do_stop() {
  acquire_lock
  prepare_existing_stack
  info "stopping the AFCT stack..."
  compose_project stop
  success "AFCT stopped. Persistent data volumes were not deleted."
}

do_recover() {
  acquire_lock
  [ ! -f "$ENV_FILE" ] || die "${ENV_FILE} already exists. Recovery is intended for a missing configuration."
  set -- "${ENV_FILE}.backup."*
  [ -e "$1" ] || die "no protected ${ENV_FILE}.backup.* files were found."
  # shellcheck disable=SC2012  # backup names are timestamped; ls -t newest-first is fine
  _latest=$(ls -1t "${ENV_FILE}.backup."* 2>/dev/null | head -n 1)
  [ -n "$_latest" ] || die "no recoverable environment backup was found."
  info "newest configuration backup: ${_latest}"
  if can_prompt && [ "$ASSUME_YES" != "true" ]; then
    confirm "Restore this configuration backup?" "y" || die "recovery cancelled."
  fi
  cp "$_latest" "$ENV_FILE" || die "could not restore ${ENV_FILE}."
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  own_deploy_path "$ENV_FILE"
  env_file_complete "$ENV_FILE" || die "the restored environment file is incomplete."
  success "Configuration restored from ${_latest}."
  info "Run: afctctl doctor"
  info "Then run: afctctl restart"
}
