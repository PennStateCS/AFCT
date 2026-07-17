# Releasing AFCT

Two kinds of images ship from this repo:

- **`:main`** — a rolling image rebuilt on every merge to `main` (by `publish-ghcr.yml`).
  Deployments that track `main` get the newest build automatically.
- **`:vX.Y.Z`** — an immutable release image, built only when you push a version tag
  (by `release.yml`). These are what the in-app updater upgrades to and downgrades
  back to. They never move.

## Cut a release

1. Make sure the commit you want to release is on `main` and has gone green in CI.
2. Tag it and push the tag:

   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

That's it. Pushing the tag triggers `release.yml`, which:

- builds and pushes `ghcr.io/pennstatecs/afct-dashboard:v1.2.3`,
- adds `v1.2.3` to `deploy/versions.json` on `main` (so the updater offers it — it
  fetches this manifest over HTTPS), and
- opens a GitHub Release with auto-generated notes.

Ordinary pushes to `main` do **not** cut a release — only a `v*` tag does.

Use a `vMAJOR.MINOR.PATCH` tag. Keep it in step with `version` in `package.json`.

## Notes

- All four images move in lockstep: a release builds `afct-dashboard`, `afct-nginx`,
  `afct-backup`, and `afct-updater` at the same `:vX.Y.Z` tag, and the deploy compose
  points every service at `${AFCT_APP_TAG}`. An in-app upgrade recreates the app,
  nginx, and backup together. The **updater** image is versioned too, but the running
  updater can't recreate its own container mid-upgrade — it picks up the new image on
  the next host-side `sh install.sh update` / `docker compose pull`.
- The manifest entry the workflow writes is minimal (`label` and `notes` default to
  the tag). Edit `deploy/versions.json` afterward if you want a friendlier label or
  real release notes shown in the Updates tab.
- To pull a bad release, remove its entry from `deploy/versions.json` on `main`. The
  updater stops offering it within its fetch interval; the image stays in GHCR but is
  no longer selectable.
