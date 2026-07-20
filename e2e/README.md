# Browser smoke suite (Playwright)

## Why this exists

The ~2300 Vitest tests mock Prisma at the route boundary. They prove each piece works
in isolation; they cannot prove auth, the database, file storage, and the UI are wired
to each other. These specs drive a real browser against a real server against a real
database.

Keep it small. A smoke suite that takes ten minutes and flakes twice a week gets
ignored. Anything testable with mocks belongs in Vitest.

## Running it

```bash
npm run e2e          # reset + seed the test DB, then run the suite
npm run e2e:db       # reset + seed only
npm run e2e:ui       # Playwright's watch UI
npm run e2e:report   # open the last HTML report
```

One-time: `npx playwright install chromium`, and create the database once with
`docker exec afct-dev-postgres psql -U afct_user -d postgres -c "CREATE DATABASE afct_test"`.

## How it is wired

- **Database**: a separate `afct_test` database inside the existing dev Postgres
  container. Never your dev data. `scripts/e2e-db.mjs` drops the schema, runs
  `migrate deploy`, and seeds; it refuses to run against any database not named
  `afct_test` or any non-local host.
- **Server**: port 3100, so it does not collide with the dev stack on 3000.
- **Users**: the dev seed's accounts, all with password `password123`. Note that
  `faculty@example.com` is *also* flagged `isAdmin`, so use `faculty2@example.com`
  (Bruce Wayne) when you mean "a plain instructor".

### Why the dev server and not a production build

`proxy.ts` reads the session cookie with `secureCookie: NODE_ENV === 'production'`, so a
production build looks for the `__Secure-`-prefixed cookie. Auth.js only *writes* that
prefixed cookie when the URL is https. A production build served over plain http
therefore writes one cookie name and reads another, and every `/dashboard` request
redirect-loops until the browser gives up.

Real deployments are https behind nginx, so the two agree there. Only this harness would
have to fake it. The tradeoff: dev mode serves CSP as Report-Only, so these specs cannot
catch a CSP regression. If that matters, serve the suite over TLS rather than loosening
the proxy.

## Status

| # | Workflow | State |
|---|----------|-------|
| - | Sign in, bad password, signed-out redirect | **passing** (`auth.spec.ts`) |
| 1 | Admin creates a course | `test.fixme` - blocked on the faculty multiselect, see `course-lifecycle.spec.ts` |
| 2 | Faculty creates and publishes an assignment | not written |
| 3 | Student sees only assigned, published work | not written |
| 4 | Student submits and sees status | not written - see below |
| 5 | Faculty views and edits a grade | not written |

### Workflow 4 is not a browser workflow

There is no student-facing file upload anywhere in the web UI. Students submit from the
JFLAP desktop client through `POST /api/client/v1/submissions` (multipart, bearer token
from `POST /api/client/v1/auth/login`). The browser only *displays* submission status.

So the useful version of this test is cross-surface: submit over the client API, then
assert the student sees it in the browser. That is a better test than the original
suggestion, and it is the shape to build.

## Map of the UI (saves rediscovery)

- Courses list: `/dashboard/courses`, button `Create Course`.
- Course page: `/dashboard/courses/{courseId}`, tabs `Assignments`, `Problems`,
  `Roster`, `Grades`, `Groups`, `Activity`, `Settings`; button `Create Assignment`.
- Assignment page: `/dashboard/courses/{courseId}/{assignmentId}` (no `/assignments/`
  segment).
- Create Course wizard: Details / Schedule / Faculty & TAs / Options / Review. See the
  comment block in `course-lifecycle.spec.ts` for every required field and gotcha.
- Create Assignment wizard: Details / Type / Assign To / Review; labels `Title`,
  `Description`.
- Grades tab (`?tab=grades`): each cell is a button labelled like `-/70`; clicking opens
  the breakdown dialog, whose inputs are labelled
  `Grade for {problem title}, maximum {n} points`.

### Known selector hazard

Several triggers render visible text that is **not** their accessible name, so
`getByRole('button', { name: <visible text> })` silently matches nothing. The faculty
multiselect is the example that blocked workflow 1. Where that bites, either match on
text (`locator('button', { hasText: ... })`) or add a real `aria-label` to the component.

## Related: the integration suite

`npm run test:integration` runs `src/**/*.integration.test.ts` against the same
`afct_test` database via `vitest.integration.config.ts`. Those are Vitest, not
Playwright, and exist for questions only a real Postgres can answer (claim exclusivity,
constraints, cascades). They are excluded from the default `vitest run` so CI stays
database-free.
