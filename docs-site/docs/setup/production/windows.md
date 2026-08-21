# Install AFCT on Windows

These instructions explain how to install AFCT on Windows for testing, evaluation, development, or demonstrations.

Windows is not the recommended platform for a long-running production deployment. For production, use the [Linux installer](./linux.md) on a Linux server.

AFCT runs on Windows through Docker Desktop with the WSL 2 backend. It runs under your current user account, so no Administrator rights are required and normal AFCT commands do not need an elevated prompt.

## Before you begin

You will need:

- Windows 10 or 11 (64-bit)
- WSL 2
- Docker Desktop
- At least 15 GB of free disk space
- Internet access during installation

Review the [system requirements](../requirements.md) before installing AFCT.

## Decide how you will access AFCT

Most Windows installations are used for local testing.

### Test on the same computer

Use:

```text
https://localhost
```

This is the simplest option. `localhost` works only from a browser on the computer running AFCT.

### Test from another device

To open AFCT from another computer or tablet on the same network, use the computer's hostname or IP address:

```text
https://192.168.1.20
```

Do not use `localhost` from another device. On that device, `localhost` refers to the device itself, not the computer running AFCT. You may need to allow incoming connections on ports 80 and 443 through Windows Defender Firewall.

### Domain names

A domain name is not required for local testing. For a long-running public or production deployment, use a Linux server instead of Windows.

## Certificates and HTTPS

AFCT normally starts with a self-signed certificate. It still encrypts the connection between the browser and AFCT; passwords, grades, and account information are not sent as plain text. The browser shows a warning because the certificate was created by the AFCT server rather than signed by an authority the browser already trusts. For a local test, confirm the address, continue past the warning, and sign in normally.

After installation, an administrator can upload a trusted certificate or request one automatically from Let's Encrypt in **Administration > System Settings**. Let's Encrypt generally requires a publicly reachable domain name and is not usually appropriate for a `localhost`-only installation.

## Step 1: Install Docker Desktop

Download and run [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/). During setup:

- **Use WSL 2 instead of Hyper-V**: keep **checked** (the recommended backend). Let the installer add the required WSL 2 components if it offers.
- If asked who to install for, choose **All users** so the engine and the `docker` CLI are available system-wide.
- Leave **Windows containers** **unchecked**. AFCT runs only Linux containers.

After it finishes, start Docker Desktop, accept the service agreement, skip the optional sign-in, and leave it on the default **Linux containers** mode. Wait until the whale icon reports the engine is running, and leave Docker Desktop running while you use AFCT.

:::note WSL 2 must be installed first
Docker Desktop's WSL 2 backend requires WSL 2 on the machine. The Docker Desktop installer normally sets this up. If it reports that WSL is missing, open **PowerShell as Administrator**, run `wsl --install`, reboot, then start Docker Desktop again.
:::

## Step 2: Check Docker

Open PowerShell and run:

```powershell
wsl --status
docker --version
docker compose version
docker info
```

Do not continue until WSL 2 is available and all Docker commands succeed. AFCT requires Docker Compose v2 (`docker compose`); the older `docker-compose` command is not supported by the Windows installer.

## Step 3: Download the AFCT installer

Create a temporary directory and download the Windows bootstrap installer:

```powershell
New-Item -ItemType Directory -Path "$HOME\afct-install" -Force | Out-Null
Set-Location "$HOME\afct-install"
Invoke-WebRequest https://github.com/PennStateCS/AFCT/releases/latest/download/install-windows.ps1 -OutFile install-windows.ps1
```

Do not run the installer from inside a cloned AFCT repository. A repository checkout contains development files and a different Docker Compose layout. Use the downloaded installer from a clean directory such as `%USERPROFILE%\afct-install`.

## Step 4: Run the installer

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

Do not use an elevated (Administrator) prompt.

The installer will:

1. Confirm that it is running on Windows.
2. Download the current Windows deployment bundle.
3. Verify the bundle's SHA-256 checksum before extracting it.
4. Inspect every archive entry for unsafe paths before extracting it.
5. Install the AFCT tools under `%LOCALAPPDATA%\AFCT` as an immutable, versioned release.
6. Create the `afctctl` command under `%LOCALAPPDATA%\AFCT\bin`.
7. Guide you through configuration.
8. Start AFCT through Docker Desktop.

The installer will ask for the following information.

### AFCT URL

For testing on the same computer, use the default:

```text
https://localhost
```

For access from another device on the same network, enter the computer's hostname or IP address. The address must match how you plan to open AFCT.

### Administrator email address

Enter the email address for the first AFCT administrator, for example `admin@example.edu`. For a local test the address does not need to receive mail, but it should be one you will recognize.

### Administrator password

You can enter your own password or let the installer generate a strong one. A generated password is displayed once at the end. Save it before closing the terminal: it is not written to the installer log.

## Step 5: Wait for AFCT to start

The first startup may take several minutes while Docker Desktop downloads the large application images, creates the containers, initializes the database, and starts the application. The installer waits for AFCT to report that it is healthy and ends with a message similar to:

```text
AFCT Dashboard is ready
```

It also displays the AFCT address, the administrator email address, and the generated password when applicable.

## Step 6: Run `afctctl`

The installer places the command at:

```text
%LOCALAPPDATA%\AFCT\bin\afctctl.cmd
```

The installer does not change your `PATH`. Run the command with its full path:

```powershell
& "$env:LOCALAPPDATA\AFCT\bin\afctctl.ps1" status
```

To make `afctctl` available by name in new terminals, add its directory to your user `PATH` once:

```powershell
$dir = "$env:LOCALAPPDATA\AFCT\bin"
$cur = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($cur -notlike "*$dir*") { [Environment]::SetEnvironmentVariable('Path', "$cur;$dir", 'User') }
```

Open a new PowerShell window afterward, then run:

```powershell
afctctl status
```

The examples below assume `afctctl` is on your `PATH`. If it is not, prefix each command with `& "$env:LOCALAPPDATA\AFCT\bin\afctctl.ps1"`.

## Step 7: Open AFCT

Open the address you entered during installation, for example `https://localhost`. Your browser will probably show a certificate warning because AFCT starts with a self-signed certificate. This is expected: the connection is encrypted, but the browser cannot verify the server's identity. Continue to the site and sign in with the administrator email address and password from the installer.

## Common AFCT commands

Run these from PowerShell. No Administrator rights are required.

```powershell
afctctl status        # container and application health
afctctl doctor        # read-only system and configuration checks
afctctl logs          # follow the application log (Ctrl+C to stop)
afctctl restart       # recreate the stack without pulling images
afctctl stop          # stop the stack without deleting data volumes
afctctl update        # pull the latest images, recreate, and verify health
afctctl self-update   # update the deployment tools to the newest verified bundle
afctctl diagnostics   # create a redacted support archive
afctctl install       # reopen the guided installer
```

## Update AFCT

To download the newest AFCT application images and restart the stack:

```powershell
afctctl update
```

Before updating, AFCT records the current image versions. If the new application fails its health check, the command restores the previous images automatically. A short-disk check runs before anything is downloaded, so an update stops while the running version is untouched rather than failing part way through a pull.

To update only the deployment tools:

```powershell
afctctl self-update
```

This downloads the newest verified deployment bundle, publishes it as a new immutable release, switches to it, and rolls back automatically if the new tools fail validation. It does not touch your database, uploads, or `.env.production`.

## Optional: enable updates from the AFCT website

AFCT can perform application upgrades and downgrades from **Administration > System Settings > Updates**.

:::warning Experimental on Windows
The in-app updater is experimental on Windows. It has not yet been validated on real Docker Desktop hardware, so the recommended way to update on Windows for now is the command line:

```powershell
afctctl update
```

The updater is the most platform-sensitive part of the deployment: it relies on Docker Desktop's Docker socket, host bind mounts, atomic replacement of the runtime Compose file, and the updater container recreating itself. Those paths behave differently under Docker Desktop than on a Linux server and have not been exercised end to end on Windows. This does not mean the updater is broken; it means it is unproven on Windows. On Linux the updater is a supported, tested feature.
:::

Enable the updater service with:

```powershell
afctctl enable-updater      # afctctl disable-updater to turn it off
```

The updater is disabled by default because it receives access to Docker Desktop's Docker socket, which provides extensive control over the Docker environment. Treat a downgrade as a recovery operation, not a casual undo: it restores a pre-upgrade database backup and permanently discards database records created since it.

## Where AFCT stores its files

AFCT stores its deployment tools and configuration under `%LOCALAPPDATA%\AFCT`:

```text
%LOCALAPPDATA%\AFCT\
  bin\                  Stable afctctl command (afctctl.cmd, afctctl.ps1)
  current\              Junction to the active deployment-tool release
  releases\             Installed deployment-tool releases (immutable)
  shared\               Persistent configuration and logs
    .env.production     AFCT configuration and secrets
    active-release      Pointer to the active release
    install-root        Install marker (guards uninstall)
    install.log         Installer log
    runtime\            Active Docker Compose configuration
```

The database and uploaded files are stored in Docker Desktop named volumes, not directly inside `%LOCALAPPDATA%\AFCT`. Removing that folder does not remove the database volumes.

## Use a custom install location

By default AFCT installs under `%LOCALAPPDATA%\AFCT`. To install somewhere else, pass an absolute path:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Prefix "D:\AFCT"
```

Docker Desktop can only bind-mount host directories that are on its file-sharing list. The default location under your user profile is already shared. A custom location may need to be added under **Docker Desktop > Settings > Resources > File sharing**. Before starting the stack, the installer runs a quick path-access test (it mounts the install directory into a small `alpine` container). If Docker Desktop cannot mount the directory, the installer stops before starting AFCT and tells you the exact path and how to fix it. Network drives and removable drives are not reliably mountable; a local path such as `%LOCALAPPDATA%\AFCT` is recommended. If your environment cannot reach Docker Hub, set `AFCT_BIND_CHECK_IMAGE` to an image that is already present locally.

## Start AFCT after restarting the computer

Docker Desktop must be running before AFCT containers can run. After restarting:

1. Open Docker Desktop.
2. Wait until Docker reports that it is running.
3. Run `afctctl status`.

The AFCT containers use Docker restart policies and may start automatically after Docker Desktop starts. If they do not, run `afctctl restart`. Tip: in Docker Desktop, enable **Start Docker Desktop when you log in** so AFCT comes back after a reboot.

## Reconfigure AFCT

To reopen the guided installer:

```powershell
afctctl install
```

To rebuild the managed configuration directly:

```powershell
afctctl install -Reconfigure
```

Existing database data and authentication secrets are preserved during reconfiguration.

## Recover a lost configuration

If the Docker volumes still hold your data but `.env.production` is missing, do not reinstall (that would generate new database credentials and orphan the database). Restore the newest protected configuration backup instead:

This safeguard only looks at the Docker volumes this installation would actually reuse. Leftover volumes from an AFCT install under a different Docker Compose project name are ignored, so they will not block a fresh install.

```powershell
afctctl recover
afctctl doctor
afctctl restart
```

## Installation problems

First, make sure Docker Desktop is open and running. Then run:

```powershell
afctctl doctor
```

To create a diagnostics archive:

```powershell
afctctl diagnostics
```

The archive is stored under `%LOCALAPPDATA%\AFCT\shared`. Known configuration secrets are redacted, but review the archive before sharing it because it can still contain details about your computer and AFCT configuration.

## Uninstall AFCT

Run:

```powershell
afctctl uninstall
```

The uninstall command preserves the database and uploaded files by default. It can remove the AFCT containers, the `afctctl` command, and the deployment directory (`%LOCALAPPDATA%\AFCT`, or a custom `-Prefix` location). The directory is removed only when it matches the install marker written at install time and has the expected AFCT layout; otherwise the command prints manual cleanup instructions instead of deleting it.

Deleting the Docker volumes is a separate, explicit opt-in (`-PurgeData`) and is never inferred from a confirmation prompt. It permanently removes the AFCT database, uploaded files, and stored backups in AFCT-managed volumes. Choose it only when you are certain you no longer need the installation.

Application images remain in Docker Desktop after uninstalling AFCT. To find them:

```powershell
docker image ls | Select-String afct
```

Continue with [TLS certificates](../../admin/system-settings.md#tls-certificate), then review [updates](../../operations/updates.md), [backups](../../operations/backups.md), and [troubleshooting](../../operations/troubleshooting.md).
