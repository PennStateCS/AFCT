# System requirements

These requirements apply to every AFCT deployment, whatever the host operating system. Each platform guide links back here and only adds its own platform-specific prerequisites.

## Hardware

Minimum practical requirements:

- At least 2 CPU cores
- At least 6 GB of RAM
- At least 5 GB of free disk space for the container images, plus room for the database and uploaded files to grow

Recommended production baseline:

- 2 or more CPU cores
- 8 GB of RAM
- 40 GB or more of persistent disk space
- A regular backup plan for the database, uploads, and configuration

The AFCT application may use up to 4 GB of memory. PostgreSQL, nginx, the backup service, and the operating system also need memory, which is why 6 GB is the practical minimum and 8 GB is a better production starting point.

## Network

- A public DNS record pointing to the host
- Inbound access on ports 80 and 443
- Internet access for downloading Docker images and installer files

Port 80 is used to redirect HTTP requests to HTTPS. Port 443 serves the secure AFCT site.

Set the DNS record before installation. `NEXTAUTH_URL` must exactly match the address users will visit: HTTPS, the right hostname, no extra path, and no unnecessary port.

## Software

| Host | Needs |
|---|---|
| AWS EC2 | Ubuntu or another Linux distribution, Docker Engine, and the Compose plugin |
| Linux | Docker Engine with the Compose plugin. The guided installer can install it on supported distributions. |
| Windows | WSL 2 and Docker Desktop |
| macOS | Docker Desktop |

Git is only needed for the manual installation method. The guided installer downloads everything it needs with `curl` on Linux and macOS, or `Invoke-WebRequest` on Windows.

## Choosing a host

Linux is the best fit for a long-running public server. For AWS, use an EC2 instance running Linux and follow the [AWS EC2 guide](production/aws.md).

Windows and macOS are supported through Docker Desktop. They are useful for local, lab, or smaller managed deployments, but they are not the best choice for a public server that needs to run continuously.
