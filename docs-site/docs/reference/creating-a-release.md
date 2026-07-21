# Creating a release

This guide is for maintainers cutting a new versioned release of AFCT for deployment.

## What a release is

AFCT is deployed as a set of container images. A **release** is an immutable, versioned
build of the whole stack, plus the metadata that lets running installs discover and
upgrade to it:

- Immutable images tagged `:vX.Y.Z`, built and pushed to GHCR:
  - `ghcr.io/pennstatecs/afct-dashboard` (the app)
  - `ghcr.io/pennstatecs/afct-nginx` (the TLS-terminating edge)
  - `ghcr.io/pennstatecs/afct-backup` (the backup sidecar)
  - `ghcr.io/pennstatecs/afct-updater` (the in-app updater sidecar)
- An entry added to the curated manifest `deploy/versions.json` on `main`. This is the
  list the installer and the in-app updater read to offer upgrade targets.
- A GitHub Release for the tag.

By contrast, the `main` tag is a **rolling** build that moves forward on every merge. It
is not a release — the installer deploys published releases only.

A release is cut by pushing a `vX.Y.Z` git tag. That is the only trigger for the
`.github/workflows/release.yml` workflow; ordinary pushes to `main` never cut a release.

## Before you tag

1. **Pick the version.** AFCT uses semantic versioning: bump the patch for fixes, the
   minor for backward-compatible features, the major for breaking changes.
2. **Choose a green commit.** Tag a commit that has already passed CI on `main`. Check
   the Actions tab, or:

   ```bash
   gh run list --branch main --workflow ci.yml --limit 5
   ```

3. **Avoid `[skip ci]` commits — this is the common footgun.** The deploy pipeline
   appends automated `chore(release): pin prod image to sha256:… [skip ci]` commits to
   `main`. GitHub honors `[skip ci]` for **all** workflows, including a tag push, so if
   your tag points at one of those bot commits the release workflow **silently never
   runs**. Always tag the newest commit whose message does **not** contain `[skip ci]`
   (usually your last real code commit):

   ```bash
   git log --oneline -5 origin/main
   ```

   The image-pin bot commits are deploy-tracking only; the release builds images from
   source, so tagging the pre-pin commit loses nothing.

## Cut the release

```bash
git fetch origin main
# Tag the last non-[skip ci] commit; substitute the real SHA.
git tag -a v0.1.3 <sha> -m "v0.1.3 - short summary"
git push origin v0.1.3
```

The `release.yml` workflow then:

1. Builds and pushes the four `:vX.Y.Z` images to GHCR.
2. Runs an informational Trivy scan (non-blocking).
3. Adds the version to `deploy/versions.json` on `main` (marking `requiresHostUpdate`
   if the updater sidecar or the compose file changed since the previous release).
4. Opens a GitHub Release with generated notes.

## Verify it triggered

Tag-triggered workflows occasionally lag; confirm a run exists for the tag:

```bash
gh api "repos/PennStateCS/AFCT/actions/runs?per_page=8" \
  --jq '[.workflow_runs[] | select(.head_branch=="v0.1.3")] | length'
```

If that returns `0` after a minute, the most likely cause is that the tag points at a
`[skip ci]` commit. Retarget the tag to a real commit and push again:

```bash
git tag -d v0.1.3
git push origin :refs/tags/v0.1.3
git tag -a v0.1.3 <non-skip-ci-sha> -m "v0.1.3 - short summary"
git push origin v0.1.3
```

Watch the build to completion:

```bash
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

When it finishes, the new version appears in `deploy/versions.json`, in the GitHub
Releases list, and — for existing installs — in the in-app Updates tab.

## Deploying the release

**Fresh install.** The installer pins the latest published release automatically. To pin
a specific one, pass it explicitly:

```bash
AFCT_APP_TAG=v0.1.3 sh install.sh
```

**Existing install (in-app).** In the app, go to **Admin → System Settings → Updates**,
pick the version, and click **Upgrade**. The stack backs up the database, pulls the new
images, recreates, and health-checks — rolling back automatically if the new version is
unhealthy.

**Host-side completion.** The in-app updater can't replace itself or apply a changed
`docker-compose.yml`. If the release is marked `requiresHostUpdate` (the Updates tab
shows a note), finish it on the server after the in-app upgrade:

```bash
sh install.sh self-update   # refresh install.sh + docker-compose.yml
sh install.sh update        # pull + recreate the whole stack, incl. the updater
```

See [Update AFCT](./updates.md) for the operator-facing update flow and
[Deployment architecture](./deployment-architecture.md) for how the images fit together.

## Rolling back

- **In-app:** the Updates tab lists restore points; downgrading restores the database
  backup taken before that version and runs the older image. This is destructive — it
  discards everything created since that backup.
- **By pin:** set `AFCT_APP_TAG` back to a previously released tag and re-run
  `sh install.sh update`.
