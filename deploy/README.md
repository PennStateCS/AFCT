# Deploying AFCT Dashboard (Linux, macOS, Windows)

This folder is a **self-contained deploy bundle**: a compose file plus a guided
installer. The only thing you need on the host is **Docker** with the Compose
plugin. On **Linux** the installer will offer to install Docker for you if it's
missing; on **Windows/macOS** install Docker Desktop first.

Use **`install.sh`** on Linux/macOS and **`install.ps1`** on Windows; they do the
same thing (prompt for admin details, generate secrets, bring the stack up).

## Quick start (Linux / macOS)

Download the three files from this `deploy/` folder into an empty directory on
the server, then run the installer.

**Once this repository is public:**

```sh
BASE=https://raw.githubusercontent.com/PennStateWilkes-Barre/AFCT-Dashboard/main/deploy
wget "$BASE/install.sh" "$BASE/docker-compose.yml" "$BASE/.env.production.example"
sh install.sh
```

**While the repository is still private**, both the raw files and the images need
authentication. On a machine that's logged in:

```sh
docker login ghcr.io                 # once, if not already
# get the deploy/ folder, e.g. clone the repo, or use the GitHub "Code -> Download":
git clone https://github.com/PennStateWilkes-Barre/AFCT-Dashboard.git
cd AFCT-Dashboard/deploy
sh install.sh
```

## Quick start (Windows)

Install **Docker Desktop** (with WSL 2) and make sure it's running. Then, in
**PowerShell**, from an empty folder:

```powershell
# Once the repository is public:
$base = 'https://raw.githubusercontent.com/PennStateWilkes-Barre/AFCT-Dashboard/main/deploy'
foreach ($f in 'install.ps1', 'docker-compose.yml', '.env.production.example') {
  Invoke-WebRequest "$base/$f" -OutFile $f
}
.\install.ps1
```

While the repository is still private, `docker login ghcr.io`, then clone the repo
and run `.\install.ps1` from its `deploy\` folder. If PowerShell blocks the script,
run it once as `powershell -ExecutionPolicy Bypass -File .\install.ps1`.

The installer will:

1. Check that Docker and the Compose plugin are installed and running (on Linux,
   offer to install Docker for you if it's missing).
2. Ask for your **administrator email**, a **password** (type your own or let it
   generate a strong one), and the **public URL** of the site.
3. Generate the remaining secrets automatically (database password, auth secret)
   and write them to `.env.production` (readable only by you).
4. Pull the images and start the stack (`app`, `nginx`, `postgres`, `db-backup`).
5. Print your site URL and admin login.

The site starts with a **self-signed certificate**, so your browser will show a
security warning at first. Install a real certificate later in
**Admin → System Settings**; no config files to edit.

> The whole bundle is just `install.sh`, `docker-compose.yml`, and
> `.env.production.example`; `wget` all three (or the release archive) into an
> empty folder, then run `sh install.sh` from it.

## If something goes wrong

The installer automatically collects a **support bundle** when it fails. You can
also create one any time:

```sh
sh install.sh diagnostics        # Linux / macOS
.\install.ps1 diagnostics        # Windows (PowerShell)
```

This writes `afct-diagnostics-<timestamp>.zip` next to the script. It contains the
install log, container status/logs, and your config **with all secret values
redacted**. Send that file to your administrator so they can help.

## Advanced

- **Non-interactive install:** set the values as environment variables and pass
  `--yes`:
  ```sh
  ADMIN_EMAIL=admin@x.edu ADMIN_PASSWORD='…' APP_URL=https://afct.x.edu \
    sh install.sh --yes
  ```
- **Manual setup:** copy `.env.production.example` to `.env.production`, fill it
  in, and run `docker compose up -d` yourself.
- **Reproducible pins:** the compose file tracks the `:main` image tag. For a
  fixed production version, replace a tag with an `@sha256:…` digest.
- **Updating:** `docker compose pull && docker compose up -d`. (One-click in-app
  updates are planned for a future release.)

## Everyday commands

```sh
docker compose ps                 # status
docker compose logs -f app        # follow app logs
docker compose down               # stop (data is preserved in named volumes)
docker compose up -d              # start again
```

## Reboots

Every container uses `restart: unless-stopped`, so the app comes back
automatically after a server reboot or a crash, as long as the Docker daemon
starts on boot. On Linux the installer enables that for you (`systemctl enable
docker`); on macOS/Windows, turn on Docker Desktop's "Start when you log in"
setting. If you deliberately `docker compose down`/`stop`, it stays down until
you start it again.
