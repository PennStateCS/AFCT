#!/bin/sh
# Output, logging, and step headings for afctctl.
#
# Sourced by afctctl; defines functions only (no work on source). Globals it reads
# (COLOR_ENABLED, LOG_ENABLED, LOG_FILE, C_*, STEP_NUM, INSTALLER_VERSION, MODE) are set
# by afctctl before these run.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

# Resolve the color palette. Called by afctctl once it has decided COLOR_ENABLED, so
# sourcing this file has no side effects.
init_colors() {
  if [ "${COLOR_ENABLED:-false}" = "true" ]; then
    C_RESET=$(printf '\033[0m')
    C_BOLD=$(printf '\033[1m')
    C_BLUE=$(printf '\033[34m')
    C_GREEN=$(printf '\033[32m')
    C_YELLOW=$(printf '\033[33m')
    C_RED=$(printf '\033[31m')
  else
    C_RESET=""
    C_BOLD=""
    C_BLUE=""
    C_GREEN=""
    C_YELLOW=""
    C_RED=""
  fi
}

append_log() {
  [ "${LOG_ENABLED:-false}" = "true" ] || return 0
  printf '%s\n' "$1" >> "$LOG_FILE" 2>/dev/null || LOG_ENABLED="false"
  return 0
}

info() {
  _line="[afct] $*"
  printf '%s\n' "$_line"
  append_log "$_line"
}

success() {
  _plain="[afct] OK: $*"
  printf '%s%s%s\n' "${C_GREEN:-}" "$_plain" "${C_RESET:-}"
  append_log "$_plain"
}

warn() {
  _plain="[afct] WARNING: $*"
  printf '%s%s%s\n' "${C_YELLOW:-}" "$_plain" "${C_RESET:-}" >&2
  append_log "$_plain"
}

error() {
  _plain="[afct] ERROR: $*"
  printf '%s%s%s\n' "${C_RED:-}" "$_plain" "${C_RESET:-}" >&2
  append_log "$_plain"
}

heading() {
  printf '\n%s%s%s\n' "${C_BOLD:-}${C_BLUE:-}" "$*" "${C_RESET:-}"
  append_log ""
  append_log "$*"
}

# Sequential step heading. A running counter (not "N of 4") so a run that skips
# configuration/review still reads 1, 2, ... with no confusing gaps.
step() {
  STEP_NUM=$(( ${STEP_NUM:-0} + 1 ))
  heading "Step ${STEP_NUM}: $*"
}

ask() {
  printf '%s' "$1" >&2
}

show_secret() {
  # Never route secrets through the installer log.
  if [ -c /dev/tty ] && printf '%s\n' "$*" > /dev/tty 2>/dev/null; then
    return 0
  fi
  printf '%s\n' "$*" >&2 || true
}

die() {
  error "$*"
  exit 1
}

rotate_installer_log() {
  [ -f "$LOG_FILE" ] || return 0
  _size=$(wc -c < "$LOG_FILE" 2>/dev/null || printf '0')
  case "$_size" in ''|*[!0-9]*) return 0 ;; esac
  [ "$_size" -lt 5242880 ] && return 0

  rm -f "${LOG_FILE}.5" 2>/dev/null || true
  _n=4
  while [ "$_n" -ge 1 ]; do
    [ -f "${LOG_FILE}.${_n}" ] && mv "${LOG_FILE}.${_n}" "${LOG_FILE}.$((_n + 1))" 2>/dev/null || true
    _n=$((_n - 1))
  done
  mv "$LOG_FILE" "${LOG_FILE}.1" 2>/dev/null || return 0
  chmod 600 "${LOG_FILE}.1" 2>/dev/null || true
}

init_log() {
  rotate_installer_log
  if touch "$LOG_FILE" 2>/dev/null && chmod 600 "$LOG_FILE" 2>/dev/null; then
    own_deploy_path "$LOG_FILE"
    LOG_ENABLED="true"
    {
      printf '\n============================================================\n'
      printf 'AFCT installer run: %s\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')"
      printf 'Deployment tool version: %s\n' "${INSTALLER_VERSION:-unknown}"
      printf 'Mode: %s\n' "${MODE:-unknown}"
    } >> "$LOG_FILE" 2>/dev/null || LOG_ENABLED="false"
  else
    LOG_ENABLED="false"
    warn "the installer log cannot be written at ${LOG_FILE}; continuing without file logging."
  fi
}
