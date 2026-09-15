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

Last updated: 2026-09-14, run on VM 210 (Win11 Pro 25H2 build 26200, Docker Desktop 29.6.2,
Compose v5.3.1) against a bundle built from this branch (deployment tool 2.5.0, release
v0.9.10). Items not marked were not reached.

First run (bundle 75a4bb03fac8) found that the install could never report success on a
default self-signed certificate. Re-tested after the fix (bundle c0ffb8bcb3e1) and the
success path now works. Items still **B** are blocked by this network, not by the code:
ghcr.io's blob CDN resolves IPv6-only from inside the container here, so a full
pull-from-cold has not been observed end to end.

## Basic installation

| #   | Item                                                                           | Status | Notes                                                                                   |
| --- | ------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| 1   | Windows 11                                                                     | T      | Win11 Pro 25H2 build 26200                                                              |
| 2   | Windows 10 (if available)                                                      | NT     |                                                                                         |
| 3   | Docker Desktop missing (clear install guidance)                                | NT     |                                                                                         |
| 4   | Docker Desktop installed but stopped (clear "start it" message)                | NT     |                                                                                         |
| 5   | Fresh install via `install-windows.ps1`                                        | T      | full startup observed end to end, ending "The web service is responding at /api/health" |
| 6   | Repeated install (idempotent; active release unchanged)                        | T      | same release id, not re-extracted                                                       |
| 7   | Custom prefix (`-Prefix`)                                                      | NT     |                                                                                         |
| 8   | Prefix containing spaces                                                       | NT     |                                                                                         |
| 9   | `https://localhost` access                                                     | T      | HTTPS 200 from the box; browser look is still a manual check                            |
| 10  | LAN IP access from another device (firewall allows 80/443)                     | NT     |                                                                                         |
| 11  | Self-signed certificate warning behaves as documented                          | NT     |                                                                                         |
| 12  | Login with generated administrator credentials                                 | NT     |                                                                                         |
| 13  | Non-interactive install (`-NonInteractive` + env vars/password file)           | T      | ADMIN_PASSWORD_FILE + APP_URL/ADMIN_EMAIL                                               |
| 14  | `Set-ExecutionPolicy`-restricted machine: `-ExecutionPolicy Bypass` path works | NT     |                                                                                         |
| 15  | WSL 2 unavailable: Docker Desktop guidance is clear                            | NT     |                                                                                         |

## Command availability

| #   | Item                                                                  | Status | Notes                                              |
| --- | --------------------------------------------------------------------- | ------ | -------------------------------------------------- |
| 1   | Full-path launch: `& "$env:LOCALAPPDATA\AFCT\bin\afctctl.cmd" status` | T      | ran from the full path, execution policy untouched |
| 2   | `afctctl status` from `C:\`, not from any AFCT directory              | T      | ran from `C:\`; no `cd` needed                     |
| 3   | `afctctl status` after adding bin to PATH                             | NT     |                                                    |
| 4   | Installer did NOT modify PATH automatically                           | NT     | Should be a deliberate manual step                 |

## Startup behaviour

| #   | Item                                                                | Status | Notes                                                                                             |
| --- | ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| 1   | Install prints a stage line per service, not one silent line        | T      | one line per service on the way up and again when each is healthy                                 |
| 2   | A long stage prints a status heartbeat about every 30s              | T      | download and container-start heartbeats both fire; elapsed label fixed since                      |
| 3   | Install finishes; `docker ps` shows all five containers             | T      | all five containers healthy and the install reports ready (reached via the already-running path)  |
| 4   | Rerunning the installer on a healthy stack skips the startup        | T      | "AFCT is already running and healthy at the expected version"; no restart, no registry call       |
| 5   | Rerunning it preserves the database (sign in with the same account) | NT     |                                                                                                   |
| 8   | The health check passes against the default self-signed certificate | T      | verified via `afctctl doctor` before and after the fix; no CI coverage, so re-check every release |
| 9   | The same install run under `pwsh` 7 rather than Windows PowerShell  | NT     | the certificate bypass takes a different branch there; no `pwsh` on VM 210                        |
| 6   | Startup failure writes a diagnostics archive and names its path     | T      | archive written and full path printed, on pull and startup failures                               |
| 7   | `shared\install.log` has a readable trace and no secrets in it      | T      | timestamped trace with exit codes; admin password and every _SECRET_/_KEY_/_TOKEN_ value absent   |

## Operational commands

| #   | Command                                                               | Status | Notes                                                            |
| --- | --------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| 1   | `afctctl status`                                                      | T      | correct table, app state and health                              |
| 2   | `afctctl doctor`                                                      | T      | 13 checks, per-service versions, and failures now say what to do |
| 3   | `afctctl logs` (Ctrl+C stops following, stack keeps running)          | NT     |                                                                  |
| 4   | `afctctl restart`                                                     | NT     |                                                                  |
| 5   | `afctctl stop`                                                        | NT     |                                                                  |
| 6   | `afctctl update`                                                      | NT     |                                                                  |
| 7   | `afctctl update` rolls back on a failed health check                  | NT     | Simulate with a bad tag/image                                    |
| 8   | `afctctl self-update` (tooling switches, data untouched)              | NT     |                                                                  |
| 9   | `afctctl diagnostics` (archive under shared\, secrets redacted)       | NT     |                                                                  |
| 10  | `afctctl recover` restores a backup when `.env.production` is missing | NT     |                                                                  |
| 11  | `afctctl reconfigure` preserves infrastructure secrets                | NT     | `afctctl install -Reconfigure`                                   |

## Uninstall

| #   | Item                                                                       | Status | Notes                                             |
| --- | -------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| 1   | `afctctl uninstall` preserves data volumes by default                      | NT     |                                                   |
| 2   | Uninstall removes the install root (marker matches)                        | NT     | Wrapper exits 0; deletion completes shortly after |
| 3   | Uninstall refuses a directory without a matching marker                    | NT     | Prints manual-cleanup guidance                    |
| 4   | `afctctl uninstall -PurgeData` deletes volumes only with the explicit flag | NT     | Never inferred from a Yes prompt                  |

## Docker Desktop behavior

| #   | Item                                                                               | Status | Notes                                                                      |
| --- | ---------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| 1   | Restart Docker Desktop                                                             | NT     |                                                                            |
| 2   | Restart Windows                                                                    | NT     |                                                                            |
| 3   | AFCT containers recover after Docker Desktop starts                                | NT     |                                                                            |
| 4   | Bind-mount preflight: default prefix mounts cleanly                                | NT     |                                                                            |
| 5   | Bind-mount preflight: custom prefix INSIDE an allowed file-sharing path works      | NT     |                                                                            |
| 6   | Bind-mount preflight: custom prefix OUTSIDE the allowed path fails, names the path | NT     |                                                                            |
| 7   | Bind-mount preflight: network/removable-drive path warns (and fails the mount)     | NT     |                                                                            |
| 8   | Image-pull failure is reported as a network problem, NOT file sharing              | T      | reported as a registry problem, and the install continued on cached images |
| 9   | Path-sharing failure is reported as file sharing, NOT a download problem           | NT     | Choose a non-shared prefix                                                 |
| 10  | `AFCT_BIND_CHECK_IMAGE` override uses an already-present image                     | NT     |                                                                            |
| 11  | Low disk space: install warns, update refuses before pulling                       | T      | install warned below 15 GB                                                 |

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
- **An HTTPS request to a real self-signed endpoint.** This is the gap that let the health
  probe ship broken: it returned false against a stack that was serving correctly, which
  meant no install could report success. The suite covers which certificate mechanism the
  host needs and how a failure is classified, but nothing in CI actually completes a TLS
  handshake against AFCT's own certificate. Item 5 under Startup behaviour below is the only
  coverage there is, so treat it as required rather than optional.
- **PowerShell 7 as the host.** `install.ps1` runs the controller in-process, so
  `pwsh .\install-windows.ps1` runs the whole install under 7, where the certificate
  bypass works differently. Both paths exist in the code; only the 5.1 one has been run.
