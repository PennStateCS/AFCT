# Production deployment

AFCT is deployed as a Docker Compose stack with four services: nginx, the AFCT application, PostgreSQL, and the backup service.

Docker is the supported production method. A non-Docker deployment requires you to reproduce the container configuration, startup order, security boundaries, and backup process yourself.

## Choose a host operating system

Each operating-system guide is self-contained. You only need to read the guide for the machine that will host AFCT.

- [Deploy on Linux](production/linux.md)
- [Deploy on Windows](production/windows.md)
- [Deploy on macOS](production/macos.md)

Linux is the best fit for a long-running public server. Windows and macOS are supported through Docker Desktop and are useful for smaller or locally managed deployments.

## Choose an installation method

Each guide includes two paths.

### Guided installer

The guided installer is recommended for most installations. It checks Docker, collects the required settings, generates secrets, creates `.env.production`, starts the stack, and can create a redacted diagnostics archive.

### Manual installation

Use the manual method when you need to customize the Compose configuration, automate provisioning, or manage the repository directly with Git.

Both methods create the same AFCT stack.

A [non-Docker outline](production/non-docker.md) is available for teams that must reproduce the deployment manually, but that path is not supported.

## Before installation

Prepare the following:

- At least 2 CPU cores
- At least 6 GB of RAM
- A public DNS record for the AFCT host
- Inbound access on ports 80 and 443
- Internet access for Docker images and installation files

The public address must be known before configuration because `NEXTAUTH_URL` must exactly match the HTTPS address users enter in their browsers.

## After installation

Use these guides for routine administration:

- [Configure TLS and HTTPS](../operations/tls.md)
- [Update AFCT](../operations/updates.md)
- [Manage backups and recovery](../operations/backups.md)
- [Troubleshoot a deployment](../operations/troubleshooting.md)
- [Understand the deployment architecture](../reference/deployment-architecture.md)
