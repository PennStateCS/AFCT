# Production deployment

AFCT is deployed as a Docker Compose stack with four core services: nginx, the AFCT application, PostgreSQL, and the backup service. An optional updater service supports browser-based upgrades and is disabled by default.

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

**Use the guided installer.** It is the recommended method for every platform: it checks Docker, collects the required settings, generates secrets, creates `.env.production`, and starts the stack. It also serves as an operations helper for a running deployment, with `status`, `logs`, `update` with automatic rollback, `restart`, `stop`, `doctor`, `recover`, and `diagnostics` commands.

A manual installation path is documented after the installer in each platform guide. Use it only when you need to customize the Compose configuration, automate provisioning, or manage the repository directly with Git. Both methods create the same AFCT stack.

A [non-Docker outline](production/non-docker.md) is available for teams that must reproduce the deployment manually, but that path is not supported.

## Before installation

Review the [system requirements](requirements.md) for hardware, network, and platform prerequisites.

Set the public DNS name before configuration. `NEXTAUTH_URL` must exactly match the HTTPS address users enter in their browsers.

## After installation

Use these guides for routine administration:

- [Configure TLS and HTTPS](../admin/system-settings.md#tls-certificate)
- [Update AFCT](../operations/updates.md)
- [Manage backups and recovery](../operations/backups.md)
- [Troubleshoot a deployment](../operations/troubleshooting.md)
- [Understand the system architecture](../reference/system-architecture.md)
