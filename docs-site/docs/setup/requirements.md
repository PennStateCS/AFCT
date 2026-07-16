# System requirements

These requirements apply to every AFCT deployment, whatever the host operating
system. Each platform guide links back here and only adds its own
platform-specific prerequisites.

## Hardware

- At least 2 CPU cores
- At least 6 GB of RAM
- At least 5 GB of free disk space for the container images, plus room for the
  database and uploaded files to grow

The AFCT application may use up to 4 GB of memory. PostgreSQL, nginx, the backup
service, and the operating system also need memory, which is why 6 GB is the
practical minimum.

## Network

- A public DNS record pointing to the host
- Inbound access on ports 80 and 443 (port 80 is used to redirect HTTP to HTTPS)
- Internet access, for downloading Docker images and installer files

Set the DNS record before installation. `NEXTAUTH_URL` must exactly match the
address users will visit — HTTPS, the right hostname, no extra path or port —
so the public address has to be known before you configure anything.

## Software

| Host | Needs |
|---|---|
| Linux | Docker Engine with the Compose plugin (the guided installer can install it) |
| Windows | WSL 2 and Docker Desktop |
| macOS | Docker Desktop |

Git is only needed for the manual installation method; the guided installer
downloads everything it needs with `curl` (or `Invoke-WebRequest` on Windows).

## Choosing a host

Linux is the best fit for a long-running public server. Windows and macOS are
supported through Docker Desktop and are useful for smaller or locally managed
deployments.
