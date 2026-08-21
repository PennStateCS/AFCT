# Install AFCT on Linux

These instructions explain how to install AFCT on a Linux server or Linux computer.

The commands are written for:

- Ubuntu
- Amazon Linux 2023

Other Linux distributions can also run AFCT. Install Docker Engine and the Docker Compose plugin for your distribution, then continue with the AFCT installation steps.

## Before you begin

You will need:

- A Linux server or Linux computer
- A user account with sudo access
- At least 15 GB of free disk space
- Internet access during installation
- Ports 80 and 443 available if other users will connect to AFCT

Review the [system requirements](../requirements.md) before installing AFCT.

## Decide how people will access AFCT

Before running the installer, decide whether this is a local test installation or a production deployment.

### Local test installation

You do not need a domain name to test AFCT on your own computer or on a temporary server.

You can use a local address such as:

```text
https://localhost
```

You may also use the server's IP address during testing:

```text
https://192.0.2.10
```

Use the address that you will actually enter in your browser.

A local test installation is useful for:

- Trying AFCT before deploying it
- Development
- Demonstrations
- Testing updates
- Learning how the system works

Do not use `localhost` if you plan to connect from another computer. On another computer, `localhost` refers to that computer, not the AFCT server.

To access AFCT from another device on the same network, use the Linux computer's IP address instead.

AFCT normally begins with a self-signed certificate. Your browser will warn that the certificate is not trusted. This is expected during local testing.

### Production deployment

A production deployment should ideally use a domain name or subdomain.

For example:

```text
afct.example.edu
```

Users would access AFCT at:

```text
https://afct.example.edu
```

A domain name makes it easier to:

- Request a trusted certificate
- Give users a stable address
- Move AFCT to another server later
- Avoid asking users to remember an IP address
- Configure authentication and security settings consistently

Create a DNS record that points the domain name to the server before installation when possible.

The public URL entered during installation must exactly match the address users will visit.

For example:

```text
https://afct.example.edu
```

Do not include:

- An extra path such as `/afct`
- An unnecessary port number
- A different subdomain
- A trailing slash unless the installer specifically requests one

For production use, make sure ports 80 and 443 are open in the server firewall and any cloud security group.

AFCT uses:

- Port 80 for HTTP redirects and certificate validation
- Port 443 for the secure website

You can begin with an IP address and move to a domain later. When you do, reconfigure AFCT so its public URL matches the new address.

## Certificates and HTTPS

AFCT installs with a self-signed certificate, and your browser will warn you about it the first
time you visit. The warning is about identity, not encryption: the connection is encrypted either
way, but the certificate was made by the AFCT server itself rather than signed by an authority the
browser already trusts, so the browser cannot confirm the server is the one it claims to be.

For a local test installation that is fine. Check that you typed the right address, then continue
past the warning.

**For a production installation, replace it before you invite anyone in.** Not because the traffic
is exposed, but because a permanent warning teaches your users to click through security warnings,
and leaves them no way to tell the real server from a fake one.

You do that after installing, from inside AFCT, in
[Step 7](#step-7-configure-a-trusted-certificate-for-production). It takes a certificate from your
institution, or one requested automatically from Let's Encrypt. Let's Encrypt needs a public domain
name pointing at this server, ports 80 and 443 reachable from the internet, and a hostname matching
the AFCT public URL.


## Step 1: Install Docker

Choose the section for your operating system.

### Ubuntu

Update the server and install the required tools:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
```

Install Docker using Docker's installation script:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

Start Docker and configure it to start after a reboot:

```bash
sudo systemctl enable --now docker
```

### Amazon Linux 2023

Install and start Docker:

```bash
sudo dnf install -y docker
sudo systemctl enable --now docker
```

Install the Docker Compose plugin:

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fSL \
  "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

The `$(uname -m)` part selects the correct version for Intel, AMD, or ARM servers.

### Other Linux distributions

Install:

- Docker Engine
- The Docker Compose plugin
- `curl` or `wget`

Follow the Docker installation instructions for your distribution.

Do not continue until these commands work:

```bash
sudo docker --version
sudo docker compose version
sudo docker info
```

## Step 2: Download the AFCT installer

Create a temporary directory for the installer:

```bash
mkdir -p ~/afct-install
cd ~/afct-install
```

Download the installer:

```bash
curl -fsSLO https://github.com/PennStateCS/AFCT/releases/latest/download/install.sh
```

You can use `wget` instead:

```bash
wget https://github.com/PennStateCS/AFCT/releases/latest/download/install.sh
```

## Step 3: Run the installer

Run:

```bash
sudo sh install.sh
```

The installer will check the system, download the AFCT deployment files, create the configuration, and start the application.

It will ask for the following information.

### AFCT URL

Enter the address you plan to use in your browser.

For a local test on the same computer:

```text
https://localhost
```

For a test server accessed by IP address:

```text
https://192.0.2.10
```

For a production deployment:

```text
https://afct.example.edu
```

The address must match how users will access AFCT.

To change the address later, run:

```bash
sudo afctctl install --reconfigure
```

### Administrator email address

Enter the email address for the first AFCT administrator.

For example:

```text
admin@example.edu
```

For a local test, this does not need to be a publicly reachable address, but it should still be an address you will recognize.

### Administrator password

You can:

- Enter your own password
- Let the installer generate a strong password

When the installer generates a password, it displays it once at the end. Save it before closing the terminal.

The password is not written to the installer log.

### Service account

The installer may ask whether AFCT should use a dedicated `afct` system account.

For a shared or long-running server, accept the default.

The service account keeps the AFCT deployment separate from any one administrator's login
account, so the deployment survives that person's account being removed.

One thing to be aware of before you accept it: the installer adds that account to the `docker`
group, and it has to, because it cannot run the stack otherwise. Membership of the `docker` group
is effectively root on the host. That is true of anyone who runs Docker on this machine, not
something AFCT introduces, but it is worth knowing you are creating such an account.

For a temporary local test the dedicated account is still fine. Choose current-user mode only when
you have a specific reason to.

## Step 4: Wait for AFCT to start

The first startup can take several minutes because Docker must download the application images and initialize the database.

The installer will wait for the application health check.

A successful installation ends with a message similar to:

```text
AFCT Dashboard is ready
```

It will also show:

- The AFCT web address
- The administrator email address
- The generated password, when applicable

## Step 5: Check the installation

Run:

```bash
sudo afctctl status
```

You should see that the AFCT application is running and healthy.

Run the system checks:

```bash
sudo afctctl doctor
```

To view the application log:

```bash
sudo afctctl logs
```

Press `Ctrl+C` when you are finished viewing the log. AFCT will continue running.

## Step 6: Open AFCT

Open the address you entered during installation.

Examples:

```text
https://localhost
```

```text
https://192.0.2.10
```

```text
https://afct.example.edu
```

Your browser will probably display a certificate warning because AFCT starts with a self-signed certificate.

This is expected. The connection is still encrypted, but the browser cannot verify the identity of the server because the certificate was not signed by a certificate authority it already trusts.

Confirm that you entered the correct AFCT address before continuing past the warning.

Sign in with the administrator email address and password you entered during installation.

For local testing, you may continue using the self-signed certificate.

For production, open the AFCT administration interface and replace it with a trusted certificate.

You can either:

- Upload a certificate and private key
- Use a certificate issued by your organization
- Request a certificate automatically from Let’s Encrypt

## Step 7: Configure a trusted certificate for production

After signing in as an administrator, open the certificate settings in the AFCT administration interface.

Choose one of the available options.

### Upload an existing certificate

Use this option if your organization or another certificate authority has already provided:

- A certificate
- A private key
- Any required intermediate certificate chain

The certificate must match the hostname users will visit.

### Request a certificate from Let’s Encrypt

Use this option if the AFCT server is publicly reachable and the domain name already points to it.

Before starting the request, confirm that:

- The AFCT domain resolves to this server
- Port 80 is open
- Port 443 is open
- No other service is using those ports
- The public URL in AFCT matches the domain name

AFCT will request and install the certificate through the administration interface.

After the certificate is installed, reload the site and confirm that the browser no longer displays a certificate warning.

## Where AFCT is installed

AFCT stores its deployment files under:

```text
/opt/afct
```

The main directories are:

```text
/opt/afct/
  current/              Active deployment tools
  releases/             Installed deployment-tool versions
  shared/               Persistent configuration and logs
    .env.production     AFCT configuration and secrets
    deploy.state        What the installer recorded about this deployment
    install.log         Installer log
    runtime/            Active Docker Compose configuration
```

Application data is stored in Docker volumes.

Updating the deployment tools does not replace the configuration or database.

## Common AFCT commands

You can run these commands from any directory.

Check the application:

```bash
sudo afctctl status
```

Run system checks:

```bash
sudo afctctl doctor
```

View the application log:

```bash
sudo afctctl logs
```

Restart AFCT:

```bash
sudo afctctl restart
```

Stop AFCT:

```bash
sudo afctctl stop
```

Update the AFCT application:

```bash
sudo afctctl update
```

Update the deployment tools:

```bash
sudo afctctl self-update
```

Restore the last good configuration, if a change to `.env.production` broke the deployment:

```bash
sudo afctctl recover
```

Create a support archive, with secrets removed, to attach to a bug report:

```bash
sudo afctctl diagnostics
```

## Update AFCT

`sudo afctctl update` pulls the latest images, recreates the stack, and waits for the health
check. If the new version does not come up healthy it puts the previous one back by itself, using
the images already on disk, so a rollback works even if the server is offline.

Two things to know before you run it:

- **It needs about 12 GB free** on the disk holding Docker's images, and refuses to start
  otherwise. An upgrade holds the old and the new image at once. It prunes the superseded ones
  after a successful update, so a deployment that stays current should not accumulate them.
- **Take a backup first.** Not for the upgrade, which rolls itself back, but because a
  **downgrade** does not: going back to an earlier version restores that version's database and
  **permanently discards anything recorded since**, grades included. Only downgrade when you
  accept that.

You can also update from the browser, without a terminal, once the updater is enabled. See
[Update AFCT](../../operations/updates.md).

## Run the installer again

You normally use `afctctl` after the first installation.

To reopen the installation and repair menu, run:

```bash
sudo afctctl install
```

The installer will detect the existing configuration and offer options to:

- Start or repair AFCT
- Update the application
- Reconfigure the public URL
- Run system checks
- Create a diagnostics archive

Existing database and authentication secrets are preserved.

To change the AFCT URL or other installation settings directly, run:

```bash
sudo afctctl install --reconfigure
```

## Optional: enable updates from the AFCT website

AFCT can perform application upgrades and downgrades from the administration interface.

Enable this feature with:

```bash
sudo afctctl enable-updater
```

The updater is disabled by default because it requires access to the Docker socket, which provides extensive control over the server.

You can disable it later:

```bash
sudo afctctl disable-updater
```

## Installation problems

First, run:

```bash
sudo afctctl doctor
```

Then create a diagnostics archive:

```bash
sudo afctctl diagnostics
```

The archive is saved under:

```text
/opt/afct/shared
```

Review the archive before sharing it because diagnostic information may contain details about your server configuration.

Continue with [TLS certificates](../../admin/system-settings.md#tls-certificate), then review [updates](../../operations/updates.md), [backups](../../operations/backups.md), and [troubleshooting](../../operations/troubleshooting.md).
