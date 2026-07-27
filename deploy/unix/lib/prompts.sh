#!/bin/sh
# Interactive prompt helpers and administrator-password sourcing for afctctl.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl
# (NON_INTERACTIVE, ASSUME_YES, INVOCATION_DIR) and the ADMIN_PASSWORD[_FILE] env vars.
# Never writes a password to the log.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl
# shellcheck disable=SC2034  # TTY_ECHO_DISABLED is consumed cross-file (common.sh)

can_prompt() {
  [ "${NON_INTERACTIVE:-false}" != "true" ] && [ -t 0 ]
}

prompt_default() {
  _question=$1
  _default=$2

  if ! can_prompt; then
    printf '%s' "$_default"
    return 0
  fi

  ask "${_question} [${_default}]: "
  IFS= read -r _answer || _answer=""
  [ -n "$_answer" ] && printf '%s' "$_answer" || printf '%s' "$_default"
}

prompt_required() {
  _question=$1
  can_prompt || return 1

  while :; do
    ask "${_question}: "
    if ! IFS= read -r _answer; then
      return 1
    fi
    [ -n "$_answer" ] && {
      printf '%s' "$_answer"
      return 0
    }
    warn "a value is required."
  done
}

prompt_secret() {
  _question=$1
  can_prompt || return 1

  ask "${_question}: "
  if stty -echo 2>/dev/null; then
    TTY_ECHO_DISABLED="true"
  fi

  if ! IFS= read -r _answer; then
    restore_terminal
    return 1
  fi

  restore_terminal
  printf '%s' "$_answer"
}

confirm() {
  _question=$1
  _default=${2:-y}

  if [ "${ASSUME_YES:-false}" = "true" ]; then
    _answer=$_default
  else
    _answer=$(prompt_default "$_question" "$_default")
  fi

  case "$_answer" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

read_password_source() {
  if [ -n "${ADMIN_PASSWORD:-}" ] && [ -n "${ADMIN_PASSWORD_FILE:-}" ]; then
    die "set only one of ADMIN_PASSWORD or ADMIN_PASSWORD_FILE."
  fi

  if [ -n "${ADMIN_PASSWORD_FILE:-}" ]; then
    case "$ADMIN_PASSWORD_FILE" in
      /*) _password_file=$ADMIN_PASSWORD_FILE ;;
      *) _password_file=${INVOCATION_DIR}/${ADMIN_PASSWORD_FILE} ;;
    esac
    [ -f "$_password_file" ] || die "ADMIN_PASSWORD_FILE does not exist: ${ADMIN_PASSWORD_FILE}"
    [ -r "$_password_file" ] || die "ADMIN_PASSWORD_FILE is not readable: ${ADMIN_PASSWORD_FILE}"
    _password_from_file=$(cat "$_password_file")
    printf '%s' "$_password_from_file"
    return 0
  fi

  printf '%s' "${ADMIN_PASSWORD:-}"
}
