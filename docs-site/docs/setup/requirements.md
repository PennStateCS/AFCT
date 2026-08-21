# System requirements

These requirements apply to every AFCT deployment, whatever the host operating system. Each platform guide links back here and only adds its own platform-specific prerequisites.

## Hardware

Minimum practical requirements:

- At least 2 CPU cores
- At least 6 GB of RAM
- At least 15 GB of free disk space, plus room for the database and uploaded files to grow

Recommended production baseline:

- 2 or more CPU cores
- 8 GB of RAM
- 40 GB or more of persistent disk space
- A regular backup plan for the database, uploads, and configuration

The AFCT application may use up to 4 GB of memory, and so may the evaluator worker that grades submissions. PostgreSQL, nginx, the backup service, and the operating system need their share as well, which is why 6 GB is the practical minimum and 8 GB is a better production starting point.

**Take the disk figure seriously.** The installer warns below 15 GB, and an update **refuses to
run** below about 12 GB free, because an upgrade holds both the old and the new application image
at once and the image is a large one. A host that squeaks through the install on 5 GB can never
update afterwards, which is the worst version of this problem: it does not show up until you need
a fix.

## Network

For a server other people will use:

- A public DNS record pointing to the host
- Inbound access on ports 80 and 443

For any installation, including a local one you are only trying out:

- Internet access for downloading Docker images and installer files

A local test installation needs neither a DNS record nor inbound ports. Each platform guide says
where that changes what you do.

Port 80 is used to redirect HTTP requests to HTTPS. Port 443 serves the secure AFCT site.

Set the DNS record before you install. The installer asks for the **Public URL**, and it has to
be exactly the address people will type: HTTPS, the right hostname, no trailing path, and no port
unless you genuinely serve on one. Getting it wrong is the most common cause of an installation
that comes up but will not let anyone sign in.

## Software

| Host    | Needs                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------ |
| AWS EC2 | Ubuntu or another Linux distribution, Docker Engine, and the Compose plugin                            |
| Linux   | Docker Engine with the Compose plugin. The guided installer can install it on supported distributions. |
| Windows | WSL 2 and Docker Desktop                                                                               |
| macOS   | Docker Desktop                                                                                         |

You do not need Git. The installer downloads everything it needs with `curl` on Linux and macOS, or `Invoke-WebRequest` on Windows.

## One thing to arrange off the machine

Backups are encrypted, and AFCT refuses to write one without a passphrase. Decide where that
passphrase will live before you install, somewhere that is not the server, because a backup you
cannot decrypt is not a backup. See [Backups](../operations/backups.md).

For which platform to install on, see [Choose a platform](production.md).
