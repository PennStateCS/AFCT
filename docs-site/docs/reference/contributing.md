# Contributing changes

This guide is for anyone writing code for AFCT, especially student research assistants.
It explains how to work in a branch, open a pull request, and — most importantly — how to
check your work **before** it reaches `main` so the automated jobs pass on the first try.

## Why jobs fail after a merge

Every push and pull request runs a set of automated checks (Continuous Integration, or
"CI"). The same checks that run in the cloud can be run on your own machine. Jobs fail
after a merge for one reason almost every time: **the change was merged before those
checks were green.** If you run the checks locally first and fix what they report, the
cloud run has almost nothing left to catch.

The rest of this guide is how to do exactly that.

## The workflow at a glance

1. Start a branch from an up-to-date `main`.
2. Make your change in small, focused commits.
3. Run the local checks and fix anything they report.
4. Push the branch and open a pull request.
5. Wait for every CI check to go green on the pull request.
6. Merge only after CI is green.

Never push straight to `main`. Always go through a branch and a pull request so CI runs
before the code is merged, not after.

## 1. Start a branch

Always branch from the latest `main`:

```bash
git checkout main
git pull origin main
git checkout -b your-name/short-description
```

Use a short, descriptive branch name, such as `alex/fix-roster-sort` or
`priya/add-late-badge`. One branch per task.

## 2. Commit your work

Make small commits with clear messages. A good message says what changed in one line:

```bash
git add -A
git commit -m "Fix roster sort order on the grades page"
```

Commit often. Small commits are easier to review and easier to undo if something goes
wrong.

:::note One-time setup
The first time you clone the repo, run `npm install` once. Besides installing
dependencies, it installs a **pre-commit hook** that keeps the generated API types in
sync automatically. If you commit from a tool that bypasses hooks, you lose that safety
net, so prefer committing from the command line.
:::

## 3. Run the checks locally (the important part)

Run these from the repository root **before you push**. They are the same checks CI runs,
so if they pass locally they will almost always pass in the cloud.

:::tip Running the dev environment in Docker?
If you develop inside the Docker dev container (the common setup), run these commands
**inside the container**, not on your host. The prefix is `docker exec afct-dev`. See
[If your dev environment runs in Docker](#if-your-dev-environment-runs-in-docker) below
for the exact commands. The commands themselves are identical; only where you run them
changes.
:::

| Run this locally                     | What it checks                              | Matching CI job |
| ------------------------------------ | ------------------------------------------- | --------------- |
| `npm run typecheck:all`              | TypeScript types (app + tests)              | `typecheck`     |
| `npm run lint -- --max-warnings=0`   | Lint rules, **warnings fail too**           | `lint`          |
| `npm test`                           | Unit tests (no database needed)             | `test`          |
| `npm run build`                      | The production build compiles               | `build`         |
| `npm run docs`                       | API spec + generated types are valid        | `docs-check`    |
| `npm run test:db`                    | Database tests (needs Postgres, see below)  | `test-db`       |

### Run them all at once

Copy-paste this. It stops at the first failure so you fix problems in order:

```bash
npm run typecheck:all && \
npm run lint -- --max-warnings=0 && \
npm test && \
npm run build && \
npm run docs
```

On Windows PowerShell, chain with `;` and check each result, or just run the commands one
at a time.

If that whole sequence passes, five of the six CI jobs will pass. The sixth is the
database job, covered next.

### If your dev environment runs in Docker

Most people develop AFCT inside the Docker dev stack (`npm run docker:dev`). In that
setup the dependencies and the generated Prisma client live **inside** the `afct-dev`
container, in a Docker volume, not on your host. So running `npm run typecheck:all` on
your host machine will fail or behave oddly. Run the same checks inside the container by
prefixing each with `docker exec afct-dev`:

```bash
docker exec afct-dev npm run typecheck:all
docker exec afct-dev npm run lint -- --max-warnings=0
docker exec afct-dev npm test
docker exec afct-dev npm run build
docker exec afct-dev npm run docs
```

Or all at once (the container's shell stops at the first failure):

```bash
docker exec afct-dev sh -c "npm run typecheck:all && npm run lint -- --max-warnings=0 && npm test && npm run build && npm run docs"
```

The commands are exactly the same as the host commands above. The only difference is the
`docker exec afct-dev` prefix that runs them inside the container, where the dependencies
already are. The dev stack must be running (`npm run docker:dev`) for these to work.

:::note About `npm run docs`
`npm run docs` can change `src/types/api.ts`. Because your source is bind-mounted into the
container, the regenerated file appears on your host too, so you can commit it normally.
:::

### The database test job

`npm run test:db` runs tests against a **real** Postgres database named `afct_test`. It is
the one check that needs a database running. If you have Docker, start a throwaway one:

```bash
# Start a disposable Postgres for the DB tests (port 5433 avoids the dev database on 5432)
docker run --rm -d --name afct-test-db -p 5433:5432 \
  -e POSTGRES_DB=afct_test -e POSTGRES_USER=afct_user -e POSTGRES_PASSWORD=afct_pass \
  postgres:15-alpine

# Point the tests at it, apply migrations, then run them
export DATABASE_URL=postgresql://afct_user:afct_pass@localhost:5433/afct_test
npx prisma migrate deploy
npm run test:db

# When you are done
docker stop afct-test-db
```

On Windows PowerShell, set the URL with
`$env:DATABASE_URL="postgresql://afct_user:afct_pass@localhost:5433/afct_test"` instead of
`export`.

If you already run the Docker dev stack, you don't need a separate container. Create an
`afct_test` database in the dev Postgres and run the DB tests inside the `afct-dev`
container against it:

```bash
# Create the test database in the running dev Postgres (safe to re-run)
docker exec afct-dev-postgres psql -U afct_user -d afct -c "CREATE DATABASE afct_test" || true

# Apply migrations and run the DB tests inside the app container, pointed at afct_test
docker exec -e DATABASE_URL=postgres://afct_user:afct_pass@postgres:5432/afct_test \
  afct-dev npx prisma migrate deploy
docker exec -e DATABASE_URL=postgres://afct_user:afct_pass@postgres:5432/afct_test \
  afct-dev npm run test:db
```

Inside the container the database host is `postgres` (the Compose service name), not
`localhost`.

If you can't run this locally, that's acceptable **as long as you still open a pull
request and let CI run it** before merging. What you must not do is skip it entirely and
merge straight to `main`.

## 4. Push and open a pull request

```bash
git push -u origin your-name/short-description
```

Then open a pull request on GitHub (the push output prints a link, or use the "Compare &
pull request" button on the repo page). In the description, say what the change does and
how you tested it.

## 5. Wait for CI to go green

Once the pull request is open, GitHub runs all the checks automatically. Watch them at the
bottom of the pull request page, in the **Checks** section:

- A **yellow dot** means the check is still running. Wait.
- A **green check** means it passed.
- A **red X** means it failed. Click **Details** to read the log, find the error, fix it
  on your branch, commit, and push again. CI re-runs automatically on every push.

Do not merge while anything is yellow or red. A green pull request is the goal.

## 6. Merge

When every check is green and the change has been reviewed, merge the pull request through
the GitHub button. Because CI already passed on the branch, the run on `main` after the
merge starts from a known-good state, and your job succeeds.

## What each check means when it fails

| Failing check | What it usually means | How to fix it |
| ------------- | --------------------- | ------------- |
| `typecheck`   | A TypeScript type error | Run `npm run typecheck:all` locally and fix the reported file and line |
| `lint`        | A lint error **or warning** (CI treats warnings as failures) | Run `npm run lint:fix` to auto-fix, then `npm run lint -- --max-warnings=0` to confirm |
| `test`        | A unit test failed | Run `npm test` locally; fix the code or update the test if the behavior changed on purpose |
| `test-db`     | A database test failed, or a migration is broken/missing | Run the database tests as shown above; if you changed the schema, make sure the migration is committed |
| `docs-check`  | You edited an API route's `@openapi` block but didn't commit the regenerated types | Run `npm run docs` and commit the updated `src/types/api.ts` |
| `build`       | The production build didn't compile | Run `npm run build` locally and fix the error it prints |

## Quick reference

```bash
# Start work
git checkout main && git pull origin main
git checkout -b your-name/short-description

# ... make changes, commit ...

# Check everything before pushing (on your host)
npm run typecheck:all && npm run lint -- --max-warnings=0 && npm test && npm run build && npm run docs

# Or, if you develop in Docker, run the same checks inside the container:
docker exec afct-dev sh -c "npm run typecheck:all && npm run lint -- --max-warnings=0 && npm test && npm run build && npm run docs"

# Push and open a pull request, wait for green CI, then merge
git push -u origin your-name/short-description
```
