# Install AFCT on macOS

These instructions explain how to install AFCT on a Mac for testing, evaluation, or development.

macOS is not the recommended platform for a long-running production deployment. For production, use the [Linux installer](./linux.md) on a Linux server.

AFCT runs on macOS through Docker Desktop. It runs under your current user account, so normal AFCT commands do not require sudo.

Apple Silicon and Intel Macs are supported.

## Before you begin

You will need:

- A current version of macOS
- An Apple Silicon or Intel Mac
- Docker Desktop
- At least 15 GB of free disk space
- Internet access during installation

Review the [system requirements](../requirements.md) before installing AFCT.

## Decide how you will access AFCT

Most Mac installations are used for local testing.

### Test on the same Mac

Use:

```text
https://localhost
```

This is the simplest option.

`localhost` works only from a browser on the Mac running AFCT.

### Test from another device

To open AFCT from another computer or tablet on the same network, use the Mac's local hostname or IP address.

For example:

```text
https://192.168.1.20
```

Do not use `localhost` from another device. On that device, `localhost` refers to the device itself, not the Mac running AFCT.

You may need to allow incoming connections through the macOS firewall.

### Domain names

A domain name is not required for local testing.

A public domain is useful when:

- Other users need a stable address
- The Mac is reachable from outside the local network
- You want to request a trusted certificate from Let's Encrypt

For a long-running public or production deployment, use a Linux server instead of a Mac.

## Certificates and HTTPS

AFCT normally starts with a self-signed certificate.

A self-signed certificate still encrypts the connection between the browser and AFCT. Passwords, grades, and account information are not sent across the network as plain text.

The browser displays a warning because the certificate was created by the AFCT server rather than signed by a certificate authority the browser already trusts.

The warning may say:

```text
Your connection is not private
```

or:

```text
Warning: Potential Security Risk Ahead
```

The warning does not mean that encryption is disabled. It means the browser cannot independently verify the identity of the AFCT server.

For a local test:

1. Confirm that you entered the correct AFCT address.
2. Continue past the browser warning.
3. Sign in normally.

After installation, an administrator can use the AFCT administration interface to:

- Upload a certificate issued by an organization or certificate authority
- Replace the self-signed certificate with an existing trusted certificate
- Request a certificate automatically from Let's Encrypt

Let's Encrypt generally requires a publicly reachable domain name. It is not usually appropriate for a `localhost`-only installation.

## Step 1: Install Docker Desktop

Download and install Docker Desktop from the Docker website.

You may also install it with Homebrew:

```bash
brew install --cask docker
```

Homebrew is optional. It is not required to install or run AFCT.

After installing Docker Desktop:

1. Open Docker Desktop.
2. Wait until it reports that Docker is running.
3. Leave Docker Desktop running while you use AFCT.

Docker Desktop may ask for permission to install supporting components. Follow its prompts.

## Step 2: Check Docker

Open Terminal and run:

```bash
docker --version
docker compose version
docker info
```

All three commands should succeed.

If `docker` is not found, Docker Desktop is not installed correctly or its command-line tools are unavailable.

If `docker info` fails, Docker Desktop is probably not running yet. Open Docker Desktop, wait for it to finish starting, and try again.

AFCT requires Docker Compose v2, which uses:

```bash
docker compose
```

The older `docker-compose` command is not supported by the Mac installer.

## Step 3: Check Docker Desktop resources

AFCT uses several containers, including the application, evaluator, database, web server, and backup service.

Docker Desktop should have enough:

- Memory
- CPU capacity
- Disk space

Open Docker Desktop settings and review the available resources.

AFCT needs several gigabytes of memory while running. More may be needed when downloading images, starting the evaluator, or processing submissions.

The installer and `afctctl doctor` warn when available disk space appears too low.

## Step 4: Download the AFCT installer

Create a temporary directory:

```bash
mkdir -p ~/afct-install
cd ~/afct-install
```

Download the Mac installer:

```bash
curl -fsSLO https://github.com/PennStateCS/AFCT/releases/latest/download/install-macos.sh
```

Do not run the guided installer from inside a cloned AFCT repository. A repository checkout contains development files and a different Docker Compose layout.

Use the downloaded installer from a clean directory such as `~/afct-install`.

## Step 5: Run the installer

Run:

```bash
sh install-macos.sh
```

Do not use sudo.

The installer will:

1. Confirm that it is running on macOS.
2. Download the current macOS deployment bundle.
3. Verify the bundle's SHA-256 checksum.
4. Inspect the archive before extracting it.
5. Install the AFCT tools under `$HOME/.afct`.
6. Create the `afctctl` command under `$HOME/.local/bin`.
7. Guide you through configuration.
8. Start AFCT through Docker Desktop.

The installer will ask for the following information.

### AFCT URL

For testing on the same Mac, use the default:

```text
https://localhost
```

For access from another device on the same network, enter the Mac's hostname or IP address:

```text
https://192.168.1.20
```

The address must match how you plan to open AFCT.

### Administrator email address

Enter the email address for the first AFCT administrator.

For example:

```text
admin@example.edu
```

For a local test, the address does not need to receive mail, but it should be an address you will recognize.

### Administrator password

You can:

- Enter your own password
- Let the installer generate a strong password

If the installer generates a password, it displays it once at the end.

Save the password before closing Terminal. It is not written to the installer log.

## Step 6: Wait for AFCT to start

The first startup may take several minutes.

Docker Desktop must download large application images, create the containers, initialize the database, and start the application.

The installer waits for AFCT to report that it is healthy.

A successful installation ends with a message similar to:

```text
AFCT Dashboard is ready
```

It also displays:

- The AFCT address
- The administrator email address
- The generated password, when applicable

## Step 7: Make `afctctl` available

The installer places the command at:

```text
$HOME/.local/bin/afctctl
```

If `$HOME/.local/bin` is already on your `PATH`, you can run:

```bash
afctctl status
```

If Terminal reports that `afctctl` is not found, add the directory for the current Terminal session:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

To make this permanent for the default macOS Zsh shell, add it to `~/.zshrc`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

Then open a new Terminal window or run:

```bash
source ~/.zshrc
```

You can always run the command directly without changing your `PATH`:

```bash
$HOME/.afct/current/bin/afctctl status
```

## Step 8: Check the installation

Run:

```bash
afctctl status
```

You should see that the AFCT containers and application are running.

Run the system checks:

```bash
afctctl doctor
```

To view the application log:

```bash
afctctl logs
```

Press `Control+C` when you are finished viewing the log. AFCT will continue running.

## Step 9: Open AFCT

Open the address you entered during installation.

For a local installation:

```text
https://localhost
```

Your browser will probably display a certificate warning because AFCT starts with a self-signed certificate.

This is expected. The connection is encrypted, but the browser cannot verify the server's identity because the certificate was not signed by an authority it already trusts.

Confirm that you entered the correct address, continue to the site, and sign in with the administrator email address and password from the installer.

## Common AFCT commands

Run these commands from Terminal. Do not use sudo.

Check the application:

```bash
afctctl status
```

Run system checks:

```bash
afctctl doctor
```

View the application log:

```bash
afctctl logs
```

Restart AFCT:

```bash
afctctl restart
```

Stop AFCT:

```bash
afctctl stop
```

Update the AFCT application:

```bash
afctctl update
```

Update the deployment tools:

```bash
afctctl self-update
```

Create a support archive:

```bash
afctctl diagnostics
```

Reopen the guided installer:

```bash
afctctl install
```

## Update AFCT

To download the newest AFCT application images and restart the stack:

```bash
afctctl update
```

Before updating, AFCT records the current image versions.

If the new application fails its health check, the command attempts to restore the previous images automatically.

To update only the installer and deployment-management tools:

```bash
afctctl self-update
```

This does not replace your database, uploads, or `.env.production` configuration.

## Optional: enable updates from the AFCT website

AFCT can perform application upgrades and downgrades from:

```text
Administration > System Settings > Updates
```

:::warning Experimental on macOS
The in-app updater is experimental on macOS. It has not yet been validated on real Docker Desktop hardware, so the recommended way to update on a Mac for now is the command line:

```bash
afctctl update
```

The updater is the most platform-sensitive part of the deployment. It relies on Docker Desktop's Docker socket, host bind mounts, atomic replacement of the runtime Compose file, and the updater container recreating itself. Those paths behave differently under Docker Desktop than on a Linux server and have not been exercised end to end on a Mac.

This does not mean the updater is broken. It means it is unproven on macOS. On Linux the updater is a supported, tested feature.
:::

Enable the updater service with:

```bash
afctctl enable-updater
```

Disable it later with:

```bash
afctctl disable-updater
```

The updater is disabled by default because it receives access to Docker Desktop's Docker socket. That access provides extensive control over the Docker environment.

Treat a downgrade as a recovery operation, not as a casual undo.

## Where AFCT stores its files

AFCT stores its deployment tools and configuration under:

```text
$HOME/.afct
```

The main directories are:

```text
$HOME/.afct/
  current/              Active deployment tools
  releases/             Installed deployment-tool versions
  shared/               Persistent configuration and logs
    .env.production     AFCT configuration and secrets
    deploy.state        Deployment state
    install.log         Installer log
    runtime/            Active Docker Compose configuration
```

The database and uploaded files are stored in Docker Desktop named volumes.

They are not stored directly inside `$HOME/.afct`.

Removing `$HOME/.afct` does not automatically remove the database volumes.

## Use a custom install location

By default AFCT installs under `$HOME/.afct`. To install somewhere else, pass an absolute path when you run the installer:

```bash
sh install-macos.sh --prefix "$HOME/AFCT"
```

Docker Desktop can only bind-mount host directories that are on its file-sharing list. The default location under your home directory is already shared. A custom location may need to be added under **Docker Desktop > Settings > Resources > File sharing**. If Docker Desktop cannot access the directory, the installer stops before starting AFCT and explains how to fix it. You can also reinstall using the default `$HOME/.afct` location, which always works.

`afctctl uninstall` can remove a custom location too. For safety it does so only when the directory matches the install marker written at install time and has the expected AFCT layout. Otherwise it prints manual cleanup instructions rather than guessing.

## Start AFCT after restarting the Mac

Docker Desktop must be running before AFCT containers can run.

After restarting the Mac:

1. Open Docker Desktop.
2. Wait until Docker reports that it is running.
3. Run:

```bash
afctctl status
```

The AFCT containers use Docker restart policies and may start automatically after Docker Desktop starts.

If they do not, run:

```bash
afctctl restart
```

## Reconfigure AFCT

To reopen the installation and configuration menu:

```bash
afctctl install
```

To rebuild the managed configuration directly:

```bash
afctctl install --reconfigure
```

Existing database data and authentication secrets are preserved unless the installer clearly tells you otherwise.

## Installation problems

First, make sure Docker Desktop is open and running.

Then run:

```bash
afctctl doctor
```

To create a diagnostics archive:

```bash
afctctl diagnostics
```

The archive is stored under:

```text
$HOME/.afct/shared
```

Review the archive before sharing it because diagnostic information may contain details about your Mac and AFCT configuration.

If `afctctl` is not on your `PATH`, use:

```bash
$HOME/.afct/current/bin/afctctl doctor
```

## Uninstall AFCT

Run:

```bash
afctctl uninstall
```

The uninstall command preserves the database and uploaded files by default.

It can remove:

- The AFCT containers
- The `afctctl` command
- The deployment directory (`$HOME/.afct`, or a custom `--prefix` location)

A custom `--prefix` directory is removed only when it matches the install marker and has the expected AFCT layout; otherwise the command prints manual cleanup instructions instead of deleting it.

It asks separately before deleting Docker volumes.

Deleting the Docker volumes permanently removes:

- The AFCT database
- Uploaded files
- Stored backups in AFCT-managed volumes

Choose the data-deletion option only when you are certain that you no longer need the installation.

Application images remain in Docker Desktop after uninstalling AFCT.

To find AFCT images:

```bash
docker image ls | grep afct
```

You can remove unused images later through Docker Desktop or the Docker command line.
