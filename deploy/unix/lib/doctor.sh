#!/bin/sh
# Read-only system check (doctor) for afctctl.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (COMPOSE_FILE,
# ENV_FILE, UPDATE_MIN_FREE_MB, APP_SERVICE, DOCTOR_OK, DOCTOR_WARN).
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

doctor_check() {
  _label=$1
  shift
  if "$@"; then
    success "$_label"
    DOCTOR_OK=$((DOCTOR_OK + 1))
  else
    warn "$_label"
    DOCTOR_WARN=$((DOCTOR_WARN + 1))
  fi
}

doctor_file_exists() { [ -f "$1" ]; }
doctor_env_complete() { env_file_complete "$ENV_FILE"; }
doctor_compose_valid() { compose_project config >/dev/null 2>&1; }
# Same threshold an update enforces, so doctor warns before an update refuses.
doctor_disk() {
  _available=$(free_disk_mb)
  [ -n "$_available" ] || return 0
  [ "$_available" -ge "$UPDATE_MIN_FREE_MB" ]
}
doctor_web() { http_health_responding; }
doctor_app_healthy() {
  _id=$(compose_project ps -q "$APP_SERVICE" 2>/dev/null || true)
  [ -n "$_id" ] || return 1
  [ "$(docker_cmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$_id" 2>/dev/null || true)" = "healthy" ]
}

do_doctor() {
  heading "AFCT system check"
  DOCTOR_OK=0
  DOCTOR_WARN=0

  doctor_check "Compose file exists" doctor_file_exists "$COMPOSE_FILE"
  doctor_check "Environment file exists" doctor_file_exists "$ENV_FILE"
  doctor_check "Environment configuration is complete" doctor_env_complete
  if check_sensitive_permissions "$ENV_FILE"; then
    success "Environment file permissions are private"
    DOCTOR_OK=$((DOCTOR_OK + 1))
  else
    DOCTOR_WARN=$((DOCTOR_WARN + 1))
  fi
  doctor_check "At least $((UPDATE_MIN_FREE_MB / 1024)) GB of disk space is available for image downloads" doctor_disk
  _clock_rc=0; check_clock_sync || _clock_rc=$?
  if [ "$_clock_rc" -eq 0 ]; then
    success "System clock synchronization is enabled"; DOCTOR_OK=$((DOCTOR_OK + 1))
  elif [ "$_clock_rc" -eq 2 ]; then
    info "System clock synchronization not verified (timedatectl unavailable)"
  else
    DOCTOR_WARN=$((DOCTOR_WARN + 1))
  fi

  if resolve_docker_access_soft && [ -n "$COMPOSE_KIND" ]; then
    success "Docker daemon is reachable"
    DOCTOR_OK=$((DOCTOR_OK + 1))
    doctor_check "Docker Compose configuration is valid" doctor_compose_valid
    doctor_check "Application container is healthy" doctor_app_healthy
    if command -v curl >/dev/null 2>&1; then
      doctor_check "Local AFCT health endpoint responds" doctor_web
    else
      warn "curl is unavailable; the local HTTP health check was skipped."
      DOCTOR_WARN=$((DOCTOR_WARN + 1))
    fi
    show_deployed_versions
  else
    warn "Docker or Docker Compose is unavailable."
    DOCTOR_WARN=$((DOCTOR_WARN + 1))
  fi

  info ""
  info "Doctor result: ${DOCTOR_OK} checks passed; ${DOCTOR_WARN} warnings or failures."
  [ "$DOCTOR_WARN" -eq 0 ]
}
