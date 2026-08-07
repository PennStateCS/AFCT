# Windows manual validation checklist

The automated suite (`deploy/test/windows/*.Tests.ps1`, run under Windows PowerShell 5.1 via
Pester) covers the bundle build, SHA-256 verification, ZIP-entry safety, immutable-release
publish, controller-failure rollback, uninstall safety, runtime Compose seeding, and the
pure operational modules (validation, environment, config, diagnostics redaction, recover)
with Docker absent. It does NOT cover a real Docker Desktop daemon, because GitHub-hosted
Windows runners do not provide one. This checklist is for a human on real Windows hardware
(for example VM 210, or any Windows 10/11 box with Docker Desktop + WSL 2).

Mark each item: **T** = Tested, **NT** = Not tested, **B** = Blocked, **NA** = Not
applicable. Do not mark an item Tested unless it was actually run.

Windows is a testing/evaluation/development/demonstration target. Linux remains the
recommended production platform.

Last updated: 2026-07-27. Everything below is **NT** until run on real hardware.

## Basic installation

| #   | Item                                                                           | Status | Notes |
| --- | ------------------------------------------------------------------------------ | ------ | ----- |
| 1   | Windows 11                                                                     | NT     |       |
| 2   | Windows 10 (if available)                                                      | NT     |       |
| 3   | Docker Desktop missing (clear install guidance)                                | NT     |       |
| 4   | Docker Desktop installed but stopped (clear "start it" message)                | NT     |       |
| 5   | Fresh install via `install-windows.ps1`                                        | NT     |       |
| 6   | Repeated install (idempotent; active release unchanged)                        | NT     |       |
| 7   | Custom prefix (`-Prefix`)                                                      | NT     |       |
| 8   | Prefix containing spaces                                                       | NT     |       |
| 9   | `https://localhost` access                                                     | NT     |       |
| 10  | LAN IP access from another device (firewall allows 80/443)                     | NT     |       |
| 11  | Self-signed certificate warning behaves as documented                          | NT     |       |
| 12  | Login with generated administrator credentials                                 | NT     |       |
| 13  | Non-interactive install (`-NonInteractive` + env vars/password file)           | NT     |       |
| 14  | `Set-ExecutionPolicy`-restricted machine: `-ExecutionPolicy Bypass` path works | NT     |       |
| 15  | WSL 2 unavailable: Docker Desktop guidance is clear                            | NT     |       |

## Command availability

| #   | Item                                                                  | Status | Notes                              |
| --- | --------------------------------------------------------------------- | ------ | ---------------------------------- |
| 1   | Full-path launch: `& "$env:LOCALAPPDATA\AFCT\bin\afctctl.ps1" status` | NT     |                                    |
| 2   | `.cmd` wrapper launch: `afctctl status` after adding bin to PATH      | NT     |                                    |
| 3   | Installer did NOT modify PATH automatically                           | NT     | Should be a deliberate manual step |

## Operational commands

| #   | Command                                                               | Status | Notes                          |
| --- | --------------------------------------------------------------------- | ------ | ------------------------------ |
| 1   | `afctctl status`                                                      | NT     |                                |
| 2   | `afctctl doctor`                                                      | NT     |                                |
| 3   | `afctctl logs` (Ctrl+C stops following, stack keeps running)          | NT     |                                |
| 4   | `afctctl restart`                                                     | NT     |                                |
| 5   | `afctctl stop`                                                        | NT     |                                |
| 6   | `afctctl update`                                                      | NT     |                                |
| 7   | `afctctl update` rolls back on a failed health check                  | NT     | Simulate with a bad tag/image  |
| 8   | `afctctl self-update` (tooling switches, data untouched)              | NT     |                                |
| 9   | `afctctl diagnostics` (archive under shared\, secrets redacted)       | NT     |                                |
| 10  | `afctctl recover` restores a backup when `.env.production` is missing | NT     |                                |
| 11  | `afctctl reconfigure` preserves infrastructure secrets                | NT     | `afctctl install -Reconfigure` |

## Uninstall

| #   | Item                                                                       | Status | Notes                                             |
| --- | -------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| 1   | `afctctl uninstall` preserves data volumes by default                      | NT     |                                                   |
| 2   | Uninstall removes the install root (marker matches)                        | NT     | Wrapper exits 0; deletion completes shortly after |
| 3   | Uninstall refuses a directory without a matching marker                    | NT     | Prints manual-cleanup guidance                    |
| 4   | `afctctl uninstall -PurgeData` deletes volumes only with the explicit flag | NT     | Never inferred from a Yes prompt                  |

## Docker Desktop behavior

| #   | Item                                                                               | Status | Notes                                 |
| --- | ---------------------------------------------------------------------------------- | ------ | ------------------------------------- |
| 1   | Restart Docker Desktop                                                             | NT     |                                       |
| 2   | Restart Windows                                                                    | NT     |                                       |
| 3   | AFCT containers recover after Docker Desktop starts                                | NT     |                                       |
| 4   | Bind-mount preflight: default prefix mounts cleanly                                | NT     |                                       |
| 5   | Bind-mount preflight: custom prefix INSIDE an allowed file-sharing path works      | NT     |                                       |
| 6   | Bind-mount preflight: custom prefix OUTSIDE the allowed path fails, names the path | NT     |                                       |
| 7   | Bind-mount preflight: network/removable-drive path warns (and fails the mount)     | NT     |                                       |
| 8   | Image-pull failure is reported as a network problem, NOT file sharing              | NT     | Block the registry; check the message |
| 9   | Path-sharing failure is reported as file sharing, NOT a download problem           | NT     | Choose a non-shared prefix            |
| 10  | `AFCT_BIND_CHECK_IMAGE` override uses an already-present image                     | NT     |                                       |
| 11  | Low disk space: install warns, update refuses before pulling                       | NT     |                                       |

## Experimental updater

The Windows updater is experimental. These items validate it on real hardware.

| #   | Item                                                     | Status | Notes |
| --- | -------------------------------------------------------- | ------ | ----- |
| 1   | Enable updater (`afctctl enable-updater`)                | NT     |       |
| 2   | In-app application update from System Settings > Updates | NT     |       |
| 3   | Update the updater service                               | NT     |       |
| 4   | `.env.production` remains intact                         | NT     |       |
| 5   | Runtime Compose remains mounted correctly                | NT     |       |
| 6   | Create a backup                                          | NT     |       |
| 7   | Perform a downgrade or restore                           | NT     |       |
| 8   | Restart Docker Desktop and retest updater status         | NT     |       |
| 9   | `afctctl disable-updater` removes the sidecar            | NT     |       |

## Not covered by automation

- Real Docker daemon behavior (image pulls, container start, health, volumes).
- Actual bind mounting under Docker Desktop (WSL 2 file sharing).
- The updater sidecar end to end (Docker socket, bind mounts, runtime Compose replacement,
  self-recreation, backups, restore points).
- Browser behavior for the self-signed certificate warning.
