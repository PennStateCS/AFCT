#!/bin/sh
# macOS stub for the service-account module.
#
# The dedicated system-service-account model (deploy/linux/lib/service-user.sh) is a Linux
# concept: useradd/usermod/getent/runuser, a Docker unix group, and ownership handoff.
# None of that exists or is needed on macOS, where Docker Desktop runs the daemon per-user
# and AFCT operates as the invoking user. The shared controller and modules still call
# these function names unconditionally, so this file provides the same interface as safe
# no-ops that keep SERVICE_MODE off and never touch ownership.
#
# Sourced by afctctl; defines functions only.
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

# No service account is ever enabled on macOS.
service_user_enabled() { return 1; }

# No dedicated group; callers only use this inside SERVICE_MODE branches (never taken here).
service_user_group() { printf ''; }

create_service_user() { return 0; }
add_service_user_to_docker_group() { return 0; }
ensure_service_docker_access() { return 0; }
own_service_tree() { return 0; }
write_service_marker() { return 0; }
remove_service_marker() { return 0; }
verify_service_access() { return 0; }

# Never enter service mode: AFCT runs as the current user on macOS.
activate_service_mode_from_marker() { SERVICE_MODE="false"; return 0; }

# The install/migration paths call this to set up or preserve an account; on macOS there is
# nothing to set up, so it is a no-op that leaves the current-user deployment untouched.
preserve_or_setup_service_account() { return 0; }
maybe_setup_service_user() { return 0; }
