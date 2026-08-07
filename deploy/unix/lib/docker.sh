#!/bin/sh
# Docker access resolution, Docker/Compose install assistance, and image pruning.
#
# Sourced by afctctl; defines functions only. Reads globals set by afctctl (SERVICE_MODE,
# SERVICE_USER, DOCKER_SUDO, COMPOSE_KIND, NON_INTERACTIVE, OS, LOG_FILE, and the
# DOCKER_INSTALL_* / UPDATE_IMAGE_SNAPSHOT temp paths). Calls into compose.sh
# (compose_project), service-user.sh (ensure_service_docker_access), validation.sh
# (free_disk_mb), and prompts.sh (confirm).
# shellcheck shell=sh
# shellcheck disable=SC2154  # globals are provided by afctctl

# Run a command as the dedicated service account. As root this is passwordless; runuser
# is preferred because it needs no sudoers config and re-initializes the group list.
# Both runuser and sudo RESET the environment, so the AFCT_RUNTIME_* interpolation
# variables compose_project exports must be forwarded explicitly. Without them the
# Compose file's env_file and updater mounts fall back to paths relative to the compose
# working directory and `docker compose config` fails.
run_as_service() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$SERVICE_USER" -- env \
      AFCT_RUNTIME_ENV_FILE="${AFCT_RUNTIME_ENV_FILE:-}" \
      AFCT_RUNTIME_COMPOSE_DIR="${AFCT_RUNTIME_COMPOSE_DIR:-}" \
      AFCT_RUNTIME_SHARED_DIR="${AFCT_RUNTIME_SHARED_DIR:-}" \
      "$@"
  else
    sudo -u "$SERVICE_USER" -- env \
      AFCT_RUNTIME_ENV_FILE="${AFCT_RUNTIME_ENV_FILE:-}" \
      AFCT_RUNTIME_COMPOSE_DIR="${AFCT_RUNTIME_COMPOSE_DIR:-}" \
      AFCT_RUNTIME_SHARED_DIR="${AFCT_RUNTIME_SHARED_DIR:-}" \
      "$@"
  fi
}

docker_cmd() {
  if [ "${SERVICE_MODE:-false}" = "true" ]; then
    run_as_service docker "$@"
  elif [ -n "${DOCKER_SUDO:-}" ]; then
    sudo docker "$@"
  else
    docker "$@"
  fi
}

detect_compose() {
  if docker_cmd compose version >/dev/null 2>&1; then
    COMPOSE_KIND="v2"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_KIND="v1"
    return 0
  fi
  COMPOSE_KIND=""
  return 1
}

resolve_docker_access() {
  # macOS runs Docker through Docker Desktop: no sudo, no daemon socket to escalate to.
  # Delegate to the platform resolver, which checks that Docker Desktop is installed,
  # running, and provides Compose v2. On Linux this branch is never taken and the
  # original resolution below runs unchanged.
  if [ "$OS" = "Darwin" ]; then
    platform_resolve_docker_access
    return $?
  fi

  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Run the installer."

  # Service mode routes every docker call through the service account (docker_cmd), so
  # the sudo probing below is irrelevant. Just make sure the account can reach Docker.
  if [ "${SERVICE_MODE:-false}" = "true" ]; then
    ensure_service_docker_access
    DOCKER_SUDO=""
    detect_compose || return 1
    return 0
  fi

  if docker info >/dev/null 2>&1; then
    DOCKER_SUDO=""
  elif [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then
    if [ "${NON_INTERACTIVE:-false}" = "true" ]; then
      if sudo -n docker info >/dev/null 2>&1; then
        DOCKER_SUDO="sudo"
      else
        die "Docker requires elevated access, but passwordless sudo is unavailable in non-interactive mode."
      fi
    else
      info "Docker requires elevated access; sudo may ask for your password."
      if sudo docker info >/dev/null 2>&1; then
        DOCKER_SUDO="sudo"
      else
        die "Docker is installed, but its daemon is not reachable. Start Docker and try again."
      fi
    fi
  else
    die "Docker is installed, but its daemon is not reachable. Start Docker and try again."
  fi

  detect_compose || return 1
  return 0
}

# Diagnostics must remain useful even when Docker is broken. This variant never prompts
# and never fails the caller.
resolve_docker_access_soft() {
  command -v docker >/dev/null 2>&1 || return 1

  _soft_sudo=""
  if docker info >/dev/null 2>&1; then
    _soft_sudo=""
  elif [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && \
       sudo -n docker info >/dev/null 2>&1; then
    _soft_sudo="sudo"
  else
    return 1
  fi

  DOCKER_SUDO=$_soft_sudo
  COMPOSE_KIND=""
  detect_compose || true
  return 0
}

maybe_install_docker() {
  command -v docker >/dev/null 2>&1 && return 0

  if [ "$OS" != "Linux" ]; then
    error "Docker is not installed."
    if [ "$OS" = "Darwin" ]; then
      info "Install Docker Desktop, start it, and rerun this installer:"
      info "  - Homebrew:  brew install --cask docker"
      info "  - Or download it from https://www.docker.com/products/docker-desktop/"
    fi
    die "Docker is required."
  fi

  heading "Docker is required"
  info "Docker is not installed on this host."
  info "For production, Docker's distro-specific repository instructions are recommended:"
  info "https://docs.docker.com/engine/install/"
  info "This installer can alternatively run Docker's get.docker.com convenience script."

  if [ "${NON_INTERACTIVE:-false}" = "true" ]; then
    die "Docker must be installed before a non-interactive AFCT installation."
  fi

  confirm "Install Docker using the get.docker.com convenience script?" "y" || \
    die "install Docker and rerun this script."

  _install_sudo=""
  if [ "$(id -u)" != "0" ]; then
    command -v sudo >/dev/null 2>&1 || die "installing Docker requires root or sudo."
    _install_sudo="sudo"
  fi

  DOCKER_INSTALL_SCRIPT=$(mktemp "${TMPDIR:-/tmp}/afct-get-docker.XXXXXX") || \
    die "could not create a temporary Docker installer file."
  DOCKER_INSTALL_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/afct-get-docker-output.XXXXXX") || \
    die "could not create a temporary Docker installer output file."

  info "downloading Docker's installer..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 10 --max-time 300 --retry 3 --retry-delay 2 https://get.docker.com -o "$DOCKER_INSTALL_SCRIPT" || \
      die "could not download Docker's installer."
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=30 --tries=3 -O "$DOCKER_INSTALL_SCRIPT" https://get.docker.com || \
      die "could not download Docker's installer."
  else
    die "curl or wget is required to download Docker."
  fi

  sh -n "$DOCKER_INSTALL_SCRIPT" || die "the downloaded Docker installer is not valid shell code."
  _commit=$(sed -n 's/^SCRIPT_COMMIT_SHA=["'"'"']\{0,1\}\([0-9a-f]\{7,\}\).*/\1/p' \
    "$DOCKER_INSTALL_SCRIPT" 2>/dev/null | head -n 1)
  [ -n "$_commit" ] && info "Docker installer commit: ${_commit}"

  info "installing Docker..."
  if [ -n "$_install_sudo" ]; then
    # SC2024: the redirect is intentionally the caller's; DOCKER_INSTALL_OUTPUT is our
    # own mktemp file and we want to capture the sudo'd installer's output into it.
    # shellcheck disable=SC2024
    if sudo sh "$DOCKER_INSTALL_SCRIPT" > "$DOCKER_INSTALL_OUTPUT" 2>&1; then
      _install_status=0
    else
      _install_status=$?
    fi
  else
    if sh "$DOCKER_INSTALL_SCRIPT" > "$DOCKER_INSTALL_OUTPUT" 2>&1; then
      _install_status=0
    else
      _install_status=$?
    fi
  fi

  cat "$DOCKER_INSTALL_OUTPUT" >> "$LOG_FILE" 2>/dev/null || true
  if [ "$_install_status" -ne 0 ]; then
    cat "$DOCKER_INSTALL_OUTPUT" >&2 2>/dev/null || true
    die "Docker installation failed with exit status ${_install_status}."
  fi

  command -v docker >/dev/null 2>&1 || die "Docker installation completed without installing the docker command."

  if command -v systemctl >/dev/null 2>&1; then
    if [ -n "$_install_sudo" ]; then
      sudo systemctl enable --now docker >/dev/null 2>&1 || \
        warn "Docker was installed, but its system service could not be enabled automatically."
    else
      systemctl enable --now docker >/dev/null 2>&1 || \
        warn "Docker was installed, but its system service could not be enabled automatically."
    fi
  fi

  if [ "$(id -u)" != "0" ]; then
    warn "membership in the docker group grants root-equivalent control of this host."
    if confirm "Add $(id -un) to the docker group?" "y"; then
      sudo usermod -aG docker "$(id -un)" || warn "could not add $(id -un) to the docker group."
      info "docker-group membership becomes active after the next login. This run will use sudo."
    fi
  fi

  success "Docker installed."
}

install_compose_plugin() {
  [ "$OS" = "Linux" ] || die "install the Docker Compose plugin and rerun this script."

  if [ "${NON_INTERACTIVE:-false}" = "true" ]; then
    die "the Docker Compose plugin must be installed before a non-interactive installation."
  fi

  confirm "Install the Docker Compose plugin now?" "y" || \
    die "the Docker Compose plugin is required."

  _package_sudo=""
  if [ "$(id -u)" != "0" ]; then
    command -v sudo >/dev/null 2>&1 || die "installing Docker Compose requires root or sudo."
    _package_sudo="sudo"
  fi

  info "installing the Docker Compose plugin..."
  if command -v apt-get >/dev/null 2>&1; then
    if [ -n "$_package_sudo" ]; then sudo apt-get update -y; sudo apt-get install -y docker-compose-plugin
    else apt-get update -y; apt-get install -y docker-compose-plugin; fi
  elif command -v dnf >/dev/null 2>&1; then
    if [ -n "$_package_sudo" ]; then sudo dnf install -y docker-compose-plugin; else dnf install -y docker-compose-plugin; fi
  elif command -v yum >/dev/null 2>&1; then
    if [ -n "$_package_sudo" ]; then sudo yum install -y docker-compose-plugin; else yum install -y docker-compose-plugin; fi
  elif command -v apk >/dev/null 2>&1; then
    if [ -n "$_package_sudo" ]; then sudo apk add --no-cache docker-cli-compose; else apk add --no-cache docker-cli-compose; fi
  else
    die "no supported package manager was found; install 'docker compose' manually."
  fi

  detect_compose || die "Docker Compose installation did not complete successfully."
  success "Docker Compose installed."
}

ensure_compose() {
  if detect_compose; then
    if [ "$COMPOSE_KIND" = "v1" ]; then
      warn "legacy docker-compose v1 is being used. Install the current 'docker compose' plugin when practical."
    fi
    return 0
  fi
  install_compose_plugin
}

ensure_docker_boot() {
  [ "$OS" = "Linux" ] || return 0
  command -v systemctl >/dev/null 2>&1 || return 0

  if docker_cmd info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q 'rootless'; then
    if systemctl --user is-enabled docker >/dev/null 2>&1; then
      return 0
    fi
    systemctl --user enable docker >/dev/null 2>&1 || \
      warn "rootless Docker is running, but its user service could not be enabled at login."
    return 0
  fi

  systemctl list-unit-files 2>/dev/null | grep -q '^docker\.service' || return 0
  systemctl is-enabled docker >/dev/null 2>&1 && return 0

  info "enabling Docker to start automatically after a reboot..."
  if [ "$(id -u)" = "0" ]; then
    systemctl enable docker >/dev/null 2>&1 || \
      warn "run 'systemctl enable docker' to start Docker automatically after reboot."
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl enable docker >/dev/null 2>&1 || \
      warn "run 'sudo systemctl enable docker' to start Docker automatically after reboot."
  fi
}

# Remove AFCT images that are neither in use nor needed for rollback. rollback_update_images
# re-tags recorded image IDs, so those are protected here by ID rather than by tag. An
# optional argument names a previous release tag whose images are also kept: after a
# pinned update to a different tag the snapshot has nothing recorded, and the previous
# release is the operator's downgrade path. Anything that cannot be positively identified
# is kept; failures never fail the update.
prune_superseded_images() {
  _protect_tag=${1:-}
  _keep=$(mktemp "${TMPDIR:-/tmp}/afct-keep.XXXXXX") || return 0

  if [ -n "${UPDATE_IMAGE_SNAPSHOT:-}" ] && [ -s "$UPDATE_IMAGE_SNAPSHOT" ]; then
    cut -d'|' -f2 < "$UPDATE_IMAGE_SNAPSHOT" >> "$_keep"
  fi
  compose_project config --images 2>/dev/null | while IFS= read -r _reference; do
    [ -n "$_reference" ] || continue
    docker_cmd image inspect -f '{{.Id}}' "$_reference" 2>/dev/null || true
  done >> "$_keep"
  if [ -n "$_protect_tag" ]; then
    ( AFCT_APP_TAG=$_protect_tag; export AFCT_APP_TAG; compose_project config --images 2>/dev/null ) | \
      while IFS= read -r _reference; do
        [ -n "$_reference" ] || continue
        docker_cmd image inspect -f '{{.Id}}' "$_reference" 2>/dev/null || true
      done >> "$_keep"
  fi

  if [ ! -s "$_keep" ]; then
    rm -f "$_keep"
    return 0   # nothing identified: do not risk deleting
  fi

  _removed=0
  docker_cmd images --no-trunc --format '{{.ID}}|{{.Repository}}:{{.Tag}}' 2>/dev/null |
    while IFS='|' read -r _id _reference; do
      [ -n "$_reference" ] || continue
      case "$_reference" in
        */afct-*) ;;          # only our own images; never postgres or anything else
        *) continue ;;
      esac
      case "$_reference" in
        *'<none>'*) continue ;;
      esac
      grep -qxF "$_id" "$_keep" && continue
      docker_cmd rmi "$_reference" >/dev/null 2>&1 && _removed=$((_removed + 1))
    done

  docker_cmd image prune -f >/dev/null 2>&1 || true
  rm -f "$_keep"

  _free=$(free_disk_mb)
  [ -n "$_free" ] && info "cleaned up superseded AFCT images (${_free}MB free)."
  return 0
}
