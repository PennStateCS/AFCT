# Production Deployment Plan (draft — implementation deferred)

_Last updated: 2026-07-13. Status: planning only; no code written yet. In-app
updates are intentionally deferred to a later phase._

## Goal

Make deploying AFCT Dashboard to production simple for **semi-technical users**
(comfortable running a command, not proficient in server config) on **Linux
(majority), macOS, and Windows**. One downloadable script should take them from
nothing to a running, TLS-enabled app with a working admin login — while still
letting an advanced user override anything.

## What already exists (the foundation is strong)

- **Compose stack** (`docker-compose.yml`): `app` (published GHCR image, digest
  pinned by CI), `nginx` (TLS front), `postgres`, and a `db-backup` sidecar.
- **App-managed TLS**: self-signed by default; the admin installs a real cert
  in-app (CSR / upload) via System Settings. Cert is written to a shared volume
  nginx reads.
- **Entrypoint** (`docker/entrypoint.sh`): waits for the DB, runs
  `prisma migrate deploy`, and seeds the first admin from `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` on an empty DB (`SEED_ON_START=auto`).
- **Backups**: daily DB dump + upload-volume tarball to a volume, schedule from
  System Settings; app can only *request* a backup (never modify/delete).
- **CI** publishes the image to GHCR and pins its digest in `docker-compose.yml`
  on each push to `main`.

So this is a **last-mile onboarding + updates** effort, not a "build deployment"
effort.

## Locked decisions

- **Image distribution:** make the GHCR **app + nginx images public now**
  (package visibility is independent of the still-private repo).
- **Installer:** a single **downloadable shell script** the maintainer hands out
  via `wget` + run (no `curl | sh` piping). Keep it as simple as possible.
- **Secrets:** **generate infra secrets** (`POSTGRES_PASSWORD`,
  `NEXTAUTH_SECRET`) automatically; **prompt for identity** (admin email +
  password, public URL). Admin password may be typed or auto-generated & shown
  once.
- **TLS:** default to the built-in self-signed cert; real cert configured in-app
  afterward. Installer never blocks on TLS.
- **Diagnostics:** on any wizard failure (and on demand), produce a **zip the
  user can send to the maintainer** — with all secret values redacted.
- **In-app updates:** **deferred**. When built, support **both** an explicit
  "Apply update" action and an opt-in "auto-update" toggle.

## Open decisions (need input before building)

1. **Bundle hosting** — where the `wget`-able files (`install.sh`,
   `docker-compose.yml`, `.env.production.example`) live. The main repo is
   private, so its release assets/raw files aren't anonymously downloadable yet.
   Options: a small **separate public repo** (recommended), GitHub Pages, a
   custom domain/static host, or wait until the main repo is public.
2. **Windows timing** — ship `install.ps1` alongside Phase 1, or Linux/macOS
   first and Windows later?
3. **Diagnostics destination** — what the zip's message tells the user to do
   (email address, a form, "attach to a GitHub issue").

## Phased plan

### Phase 0 — Checkout-free, no-auth distribution (prerequisite)

- Set the GHCR **app image → public**.
- Add the **nginx image** to CI (build + publish to GHCR, public); change
  `docker-compose.yml` from `build: ./docker/nginx` to a **pinned public image**
  so deployers need no repo checkout.
- Create a **`deploy/` folder**: `docker-compose.yml` (public pinned images),
  `.env.production.example`, `install.sh`, `install.ps1`, `README`. Publish it
  as a versioned bundle at the chosen host (see open decision #1).
- **Outcome:** `docker compose up` works anonymously; nothing changes when the
  repo later goes public.

### Phase 1 — The install script

User runs two commands the maintainer provides:

```
wget <host>/install.sh
sh install.sh
```

The script:

1. **Preflight** — verify Docker + Compose (Linux: offer the official install;
   macOS/Windows: point to Docker Desktop); check ports 80/443 free, disk space,
   architecture.
2. **Fetch** the version-pinned compose + env template.
3. **Wizard** — prompt admin email; admin password (type or auto-generate & show
   once); public URL (default = hostname).
4. **Generate** `POSTGRES_PASSWORD` + `NEXTAUTH_SECRET` (`openssl rand`); write
   `.env.production` at `chmod 600`.
5. `docker compose up -d`, wait for health, then print the URL, admin login, and
   "install a real certificate in Admin → System Settings."
6. Tee all output to `install.log`. Re-running is safe (detect existing `.env`,
   offer keep / regenerate).

**Advanced escape hatch:** non-interactive mode (`--yes` + env vars) and flags
for ports / external DB, so a power user scripts it or skips the wizard by
editing `.env` directly.

Windows: parallel `install.ps1` (the wizard is small enough that a port is
cheaper than adding a setup container).

### Phase 1b — Diagnostics / support bundle

`sh install.sh diagnostics` — and auto-run on any wizard failure — produces
`afct-diagnostics-<timestamp>.zip` containing:

- `install.log`
- `docker compose ps` + tailed `logs` per service
- `docker version` / `docker info`
- OS / architecture
- the compose file + resolved image digests
- health-probe results
- `.env.production` **with every secret value masked** (keys shown, values
  redacted — **mandatory scrubbing**)

Prints "send this file to \<maintainer contact\>." Lets the maintainer debug a
stranger's failed install without ever seeing real secrets.

### Phase 2 — In-app updates (deferred, but designed-for)

Not built now; the architecture won't need rework:

- **Version awareness:** expose the running version (already have `APP_VERSION`)
  + read a public release manifest so the admin menu can show "update
  available" with a changelog.
- **Least-privilege updater sidecar:** the only component with the Docker socket;
  the app calls it over the internal network. Supports **both** an explicit
  "Apply update" button and an opt-in "auto-update" toggle. (Never mount the
  Docker socket into the app itself.)

## Sequencing note

**Phase 0 (public images) + the generate-infra/prompt-identity secret model** are
the two moves that make everything downstream simple — do them first.
