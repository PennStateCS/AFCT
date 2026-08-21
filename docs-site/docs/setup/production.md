# Production deployment

AFCT runs as a Docker Compose stack of five services: nginx in front, the AFCT application, the evaluator worker that grades submissions, PostgreSQL, and the backup service. A sixth, the updater, powers browser-based upgrades and is off by default.

Docker is the supported production method. A non-Docker deployment requires you to reproduce the container configuration, startup order, security boundaries, and backup process yourself.

## Recommended hosting path

For most public deployments, use **AWS EC2 with Docker Compose**. This gives you a normal Linux server, keeps the AFCT installer workflow simple, and matches the supported production architecture.

If you are not using AWS, the same Linux guide applies to any public Linux server that supports Docker Engine and inbound HTTPS traffic.

## Choose a host

Each guide is self-contained. You only need to read the guide for the machine or service that will host AFCT.

- [AWS EC2](production/aws.md), recommended for a public production deployment
- [Linux](production/linux.md), recommended for any long-running server
- [Windows](production/windows.md), useful for smaller or locally managed deployments
- [macOS](production/macos.md), useful for smaller or locally managed deployments

Linux is the best fit for a long-running public server. Windows and macOS are supported through Docker Desktop, but they are better suited for local, lab, or smaller managed deployments.

## Choose an installation method

**Use the guided installer.** It checks Docker, asks for the settings it needs, generates the
secrets, writes `.env.production`, and starts the stack.

What it installs is a command called **`afctctl`**, and that is the name to remember: it is how
you run the deployment afterwards, from any directory.

| Command | What it does |
| --- | --- |
| `sudo afctctl status` | Container and application health |
| `sudo afctctl logs` | Follow the application log |
| `sudo afctctl update` | Pull the latest images, recreate the stack, roll back if it is not healthy |
| `sudo afctctl restart` | Recreate the stack without pulling anything new |
| `sudo afctctl stop` | Stop it, keeping the data |
| `sudo afctctl doctor` | A longer read-only check of the whole deployment |
| `sudo afctctl recover` | Restore the last good `.env.production` |
| `sudo afctctl diagnostics` | Build a support archive with secrets removed |
| `sudo afctctl enable-updater` | Turn on browser-based upgrades |
| `sudo afctctl version` | What is deployed, and what version the tool itself is |

On macOS the same commands run without `sudo`. On Windows the equivalent is `afctctl.ps1`; see
the [Windows guide](production/windows.md).

A [non-Docker outline](production/non-docker.md) is available for teams that must reproduce the deployment manually, but that path is not supported.

## Before installation

Review the [system requirements](requirements.md) for hardware, network, and platform prerequisites.

Set the public DNS name first. The installer asks for the **Public URL** and it has to match the
HTTPS address people will type, exactly.

## After installation

Use these guides for routine administration:

- [Configure TLS and HTTPS](../admin/system-settings.md#tls-certificate)
- [Update AFCT](../operations/updates.md)
- [Manage backups and recovery](../operations/backups.md)
- [Troubleshoot a deployment](../operations/troubleshooting.md)
- [Understand the system architecture](../reference/system-architecture.md)
