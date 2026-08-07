# macOS manual validation checklist

The automated suites (`deploy/test/macos-deploy.bats`, `deploy/test/macos-bootstrap.bats`)
cover the bootstrap, controller dispatch, prefix marker, uninstall safety, and the
bind-mount preflight with Docker mocked. They do NOT cover a real Docker Desktop daemon,
because GitHub-hosted macOS runners do not provide one. This checklist is for a human on
real Mac hardware.

Mark each item: **Tested**, **Not tested**, **Blocked**, or **Not applicable**. Do not mark
an item Tested unless it was actually run.

Status legend: T = Tested, NT = Not tested, B = Blocked, NA = Not applicable.

Last updated: 2026-07-27. Everything below is **NT** (no Mac hardware available to the
author). Fill in as you go.

## Basic installation

| #   | Item                                                            | Status | Notes |
| --- | --------------------------------------------------------------- | ------ | ----- |
| 1   | Apple Silicon Mac                                               | NT     |       |
| 2   | Intel Mac (if supported hardware available)                     | NT     |       |
| 3   | Docker Desktop missing (clear install guidance)                 | NT     |       |
| 4   | Docker Desktop installed but stopped (clear "start it" message) | NT     |       |
| 5   | Fresh install                                                   | NT     |       |
| 6   | Repeated install (idempotent)                                   | NT     |       |
| 7   | Custom prefix (`--prefix`)                                      | NT     |       |
| 8   | Prefix containing spaces                                        | NT     |       |
| 9   | `https://localhost` access                                      | NT     |       |
| 10  | LAN IP access from another device                               | NT     |       |
| 11  | Self-signed certificate warning behaves as documented           | NT     |       |
| 12  | Login with generated administrator credentials                  | NT     |       |

## Operational commands

| #   | Command                                         | Status | Notes |
| --- | ----------------------------------------------- | ------ | ----- |
| 1   | `afctctl status`                                | NT     |       |
| 2   | `afctctl doctor`                                | NT     |       |
| 3   | `afctctl logs`                                  | NT     |       |
| 4   | `afctctl restart`                               | NT     |       |
| 5   | `afctctl stop`                                  | NT     |       |
| 6   | `afctctl update`                                | NT     |       |
| 7   | `afctctl self-update`                           | NT     |       |
| 8   | `afctctl diagnostics`                           | NT     |       |
| 9   | `afctctl uninstall` (data preserved by default) | NT     |       |

## Docker Desktop behavior

| #   | Item                                                           | Status | Notes                                                             |
| --- | -------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| 1   | Restart Docker Desktop                                         | NT     |                                                                   |
| 2   | Restart the Mac                                                | NT     |                                                                   |
| 3   | AFCT containers recover after Docker Desktop starts            | NT     |                                                                   |
| 4   | Custom prefix INSIDE an allowed file-sharing path works        | NT     |                                                                   |
| 5   | Custom prefix OUTSIDE the allowed path fails clearly           | NT     |                                                                   |
| 6   | Error distinguishes image-pull failure from bind-mount failure | NT     | Simulate by blocking the registry vs choosing a non-shared prefix |

## Experimental updater

The macOS updater is experimental. These items validate it on real hardware.

| #   | Item                                             | Status | Notes |
| --- | ------------------------------------------------ | ------ | ----- |
| 1   | Enable updater (`afctctl enable-updater`)        | NT     |       |
| 2   | In-app application update                        | NT     |       |
| 3   | Update the updater service                       | NT     |       |
| 4   | `.env.production` remains intact                 | NT     |       |
| 5   | Runtime Compose remains mounted correctly        | NT     |       |
| 6   | Create a backup                                  | NT     |       |
| 7   | Create a restore point                           | NT     |       |
| 8   | Perform a downgrade or restore                   | NT     |       |
| 9   | Restart Docker Desktop and retest updater status | NT     |       |

## Not covered by automation

- Real Docker daemon behavior (image pulls, container start, health, volumes).
- Actual bind mounting under Docker Desktop (only mocked in CI).
- The updater sidecar end to end (socket, bind mounts, runtime Compose replacement,
  self-recreation, backups, restore points).
