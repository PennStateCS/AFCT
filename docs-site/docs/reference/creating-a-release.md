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
- The versioned **deployment tools** (the installer/updater bundles) for each platform,
  attached to the GitHub Release as assets: `afct-linux-deploy-<tool-version>.tar.gz`,
  `afct-macos-deploy-<tool-version>.tar.gz`, and `afct-windows-deploy-<tool-version>.zip`,
  each with a `.sha256`, plus the deployment manifests and the bootstrap installers
  (`install.sh`, `install-macos.sh`, `install-windows.ps1`). These carry a **separate**
  version from the app images (see [Updating the deployment tools](#updating-the-deployment-tools)).

By contrast, the `main` tag is a **rolling** build that moves forward on every merge. It
is not a release; the installer deploys published releases only.

A release is cut by pushing a `vX.Y.Z` git tag. That is the only trigger for the
`.github/workflows/release.yml` workflow; ordinary pushes to `main` never cut a release.

## Updating the deployment tools

The deployment tools are the installer and updater that put AFCT on a host: the bootstrap
installers, the `afctctl` controller, and the shared Compose file and environment template.
They ship as the per-platform bundles listed above and carry their own **deployment-tool
version**, which is deliberately independent of the app image tag `vX.Y.Z`. A given app
release just publishes whatever the deployment-tool version happens to be at that commit.

You only need to touch this when a change alters what goes into a bundle. If you are cutting
a release that changed only application code, skip this section: the existing bundles are
rebuilt at the same version and republished unchanged.

### The version is unified across platforms

There is one deployment-tool version, stored in two controllers that must always match:

| Platform | File | Line |
| --- | --- | --- |
| Linux and macOS | `deploy/unix/bin/afctctl` | `INSTALLER_VERSION="X.Y.Z"` |
| Windows | `deploy/windows/bin/afctctl.ps1` | `$InstallerVersion = 'X.Y.Z'` |

Keep them equal. The repository does not use platform-specific tool versions.

### When to bump it

Bump the deployment-tool version whenever you change any file that goes into a bundle:

- `deploy/unix/**`, `deploy/linux/**`, `deploy/macos/**`, `deploy/windows/**`
- `deploy/docker-compose.yml`
- `deploy/.env.production.example`

The version is content-addressed at install time: a host refuses to install a bundle whose
bytes differ from a version it already has. Changing bundle contents without bumping the
version would therefore ship bytes that installed hosts reject. Use semantic versioning:
patch for fixes, minor for new installer behavior, major for a breaking change to the
tooling contract.

### How to bump it

Edit both controller files to the same new version, for example `2.2.3` to `2.2.4`:

```bash
# deploy/unix/bin/afctctl
INSTALLER_VERSION="2.2.4"

# deploy/windows/bin/afctctl.ps1
$InstallerVersion = '2.2.4'
```

If a test asserts the version (the macOS bootstrap test pins the expected bundle name),
update it too. `deploy/test/macos-bootstrap.bats` is the usual one.

### CI enforces this

The Installer workflow (`.github/workflows/installer.yml`) runs `deploy/ci-version-check.sh`
on every build and blocks the merge if:

- the Unix and Windows controllers name different versions (they must agree), or
- a bundle source changed versus the base branch but the version did not change.

So a bundle change with no bump, or a Unix/Windows mismatch, fails the pull request before
it can reach a release. The Windows version is read by `deploy/ci-windows-version.ps1`, which
the workflow cross-checks against the shell reader so the two cannot drift.

### What the release does with the bundles

When you push the app tag, `release.yml` builds each platform's bundle, validates it
(checksum, manifest, version agreement, required modules, archive and ZIP path safety, and,
for Windows, that every bundled PowerShell file parses), and only then, in a single final
step, attaches every platform's assets to the GitHub Release. This is all-or-nothing: if any
platform fails to build or validate, none of the bundle assets are published, so a release is
never left with a partial set.

### How operators pick up new tools

Updating the app images does not update a host's installer tooling. Operators refresh the
tools separately, which downloads and verifies the newest published bundle and switches to it
(with rollback if the new controller fails validation):

```bash
afctctl self-update      # Linux and macOS
```

```powershell
afctctl self-update      # Windows
```

Run this before `afctctl update` when a release changed the Compose file or the updater, so
the host is applying the current tooling.

## Before you tag

1. **Pick the version.** AFCT uses semantic versioning: bump the patch for fixes, the minor
   for backward-compatible features, the major for breaking changes. The version lives in
   the tag alone. `package.json` is **not** bumped and has not been since 0.3.0, so do not
   go looking for a `bump package.json` commit to tag.
2. **Choose a green commit.** Tag a commit that has already passed CI on `main`. Check
   the Actions tab, or:

   ```bash
   gh run list --branch main --workflow ci.yml --limit 5
   ```

3. **Avoid `[skip ci]` commits; this is the common footgun.** The deploy pipeline
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

Only repository administrators can do this: a ruleset blocks creating, updating or deleting
any `v*` tag for everyone else.

```bash
git fetch origin main
# Tag the last non-[skip ci] commit; substitute the real SHA.
git tag -a v0.1.3 <sha> -m "v0.1.3 - short summary"
git push origin v0.1.3
```

:::warning Tag a commit that contains the workflow you want to run
A tag-triggered workflow runs the version of `.github/workflows/release.yml` **at the tagged
commit**, not the one on `main`. If the workflow was broken and then fixed, tagging a commit
from before the fix runs the broken copy again. Move the tag forward to a commit that
includes it.
:::

### Attaching an admin note (optional)

For the rare release where the admin must do something on the server before or after
upgrading, add a second `-m`. The first message is the normal summary; the second
becomes a free-text note shown in the Updates tab when that version is selected:

```bash
git tag -a v0.1.3 <sha> -m "v0.1.3 - short summary" -m "Increase the VM disk to 60 GB before upgrading."
git push origin v0.1.3
```

Ordinary releases use a single `-m` and show no note. Keep the note short and
actionable; it is the only place this instruction reaches the operator in-app.

The `release.yml` workflow then:

1. Builds and pushes the four `:vX.Y.Z` images to GHCR.
2. Runs an informational Trivy scan (non-blocking).
3. Adds the version to `deploy/versions.json` on `main`, including the admin note from
   the tag body if one was given and a checksum of the release's `docker-compose.yml` so
   the in-app updater can verify the stack configuration it downloads for this release.
4. Opens a GitHub Release with generated notes.

## Verify it triggered

Tag-triggered workflows occasionally lag; confirm a run exists for the tag:

```bash
gh api "repos/PennStateCS/AFCT/actions/runs?per_page=8" \
  --jq '[.workflow_runs[] | select(.head_branch=="v0.1.3")] | length'
```

If that returns `0` after a minute, there are two likely causes.

**The tag points at a `[skip ci]` commit.** Retarget it, as below.

A third case looks different, because the run does start and then fails within seconds. The
release begins with a `verify` job that refuses to publish unless a **successful CI run already
exists for the exact commit you tagged**. If you tagged a commit CI never ran on, that is where
it stops, and the error names the SHA. Either tag a commit CI has passed, or run CI on that ref
from Actions and re-tag.

**The workflow file is invalid at that commit.** GitHub cannot parse it, so nothing triggers.
The tell is in `gh run list`: a run listed as `.github/workflows/release.yml` rather than by
its name, `Release`, means GitHub fell back to the file path because it could not read the
file. Such a workflow also fires on pushes it should ignore and fails within seconds. Note
that `yaml.safe_load` will **not** catch this: it silently keeps the last of a duplicated key,
where Actions rejects the file outright.

To retarget the tag to a real commit and push again:

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
Releases list, and (for existing installs) in the in-app Updates tab.

## Deploying the release

**Fresh install.** The installer pins the latest published release automatically. To pin
a specific one, pass it explicitly:

```bash
AFCT_APP_TAG=v0.1.3 sh install.sh
```

**Existing install (in-app).** In the app, go to **Admin > System Settings > Updates**,
pick the version, and click **Upgrade**. The stack backs up the database, pulls the new
images, recreates, and health-checks, rolling back automatically if the new version is
unhealthy.

**Completing the update.** Some releases also change the stack layout
(`docker-compose.yml`) or the updater component. The in-app path now handles both, so
they no longer need a routine host-side step; if a specific release genuinely needs one,
attach an admin note to the tag (above) and it shows in the Updates tab. The in-app path
works as follows:

- A changed `docker-compose.yml` is fetched from the target release, validated, and
  applied during the upgrade, provided the updater itself is current. This needs an
  updater that includes the capability (v0.1.14 or newer), so update the updater first
  if it is behind.
- The updater can't recreate its own running container, so it is updated separately:
  the Updates tab shows **Update the update service** when it lags the app version.

The host-side commands remain as a fallback, and `self-update` is how you refresh the
deployment tools themselves (see
[Updating the deployment tools](#updating-the-deployment-tools)):

```bash
afctctl self-update   # download + switch to the newest verified deployment bundle
afctctl update        # pull + recreate the whole stack, incl. the updater
```

See [Update AFCT](../operations/updates.md) for the operator-facing update flow and
[System architecture](./system-architecture.md) for how the images fit together.

## Rolling back

- **In-app:** the Updates tab lists restore points; downgrading restores the database
  backup taken before that version and runs the older image. This is destructive: it
  discards everything created since that backup.
- **By pin:** run the update with `AFCT_APP_TAG` set to a previously released tag, for
  example `AFCT_APP_TAG=v0.1.2 afctctl update`. Once the deploy passes its health check,
  the tag is recorded in `.env.production`, so later plain updates stay on it.
