# Deploying AFCT Dashboard (Linux / macOS)

This folder is a **self-contained deploy bundle** — a compose file plus a guided
installer. You need one thing on the host: **Docker** (with the Compose plugin).

## Quick start

```sh
# 1. Get the installer (your administrator will give you the exact URL):
wget <download-url>/install.sh

# 2. Run it:
sh install.sh
```

The installer will:

1. Check that Docker + Compose are installed and running.
2. Ask for your **administrator email**, a **password** (type your own or let it
   generate a strong one), and the **public URL** of the site.
3. Generate the remaining secrets automatically (database password, auth secret)
   and write them to `.env.production` (readable only by you).
4. Pull the images and start the stack (`app`, `nginx`, `postgres`, `db-backup`).
5. Print your site URL and admin login.

The site starts with a **self-signed certificate**, so your browser will show a
security warning at first. Install a real certificate later in
**Admin → System Settings** — no config files to edit.

> The whole bundle is just `install.sh`, `docker-compose.yml`, and
> `.env.production.example`; `wget` all three (or the release archive) into an
> empty folder, then run `sh install.sh` from it.

## If something goes wrong

The installer automatically collects a **support bundle** when it fails. You can
also create one any time:

```sh
sh install.sh diagnostics
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
