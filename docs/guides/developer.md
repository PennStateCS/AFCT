# Developer guide

**Audience:** engineers working on the AFCT Dashboard.

## Stack

The versions here matter; several of them changed behavior in ways the rest of
this guide has to account for.

- **Next.js 16** (App Router): server components and route handlers, Turbopack.
- **React 19**.
- **NextAuth v5** (beta) with JWT sessions.
- **Prisma 7** against PostgreSQL, using the **`@prisma/adapter-pg` driver
  adapter**. Prisma 7 has no bundled query engine and no `datasource.url` in the
  schema; the connection comes from the adapter, which has consequences for any
  code that constructs its own client (see [Data layer](#data-layer)).
- **Zod 4** for validation.
- **TanStack Query v5** on the client.
- **Tailwind CSS 4**.
- **Vitest 4** for tests.
- **Docker** for local and production; images published to GHCR.
- **Node 22** (Docker images and CI).

## Repository layout

- `src/app/api/**/route.ts` is the API surface: HTTP route handlers, one file
  per resource path.
- `src/app/**` holds pages and client components.
- `src/lib/` is where server logic lives: `permissions.ts` (the two course
  gates), `api/` (shared route helpers), `prisma.ts` (the client), auth, the
  submission worker, and the rest.
- `src/schemas/` holds the Zod schemas for forms and routes, plus `fields.ts`
  for the reusable field primitives (see [Validation](#validation-zod)).
- `prisma/` holds the schema, migrations, and the seed (`seed.ts` dispatches to
  `seed-dev.ts` or `seed-prod.ts`).
- `docs/` holds the guides, the `reference/` pages (roles and permissions,
  client API), and the `setup/` deployment guides.

## Local development

The stack runs in Docker; there is no supported bare-metal dev mode.
`npm run docker:dev` builds and starts the app, database, nginx, a db-backup
sidecar, and Prisma Studio. The app entrypoint applies migrations on start, so a fresh start is
always up to date with the schema. To apply a new migration to an
already-running stack without bouncing the dev server, run
`npm run docker:dev:migrate:deploy`, then `npm run docker:dev:generate` if the
Prisma client changed.

> **Stale dependencies gotcha.** The dev image keeps `node_modules` in a named
> volume, and that volume survives `--build`. So after a dependency change (a
> Prisma major, for example) a rebuild can quietly hand you the old packages.
> Clear the volume: `npm run docker:dev:down:volumes`, then `npm run docker:dev`,
> and confirm the versions in the startup log rather than assuming.

Full setup lives in [`setup/development.md`](../setup/development.md) and
[`setup/production.md`](../setup/production.md).

## Authorization model

Authorization is a **global admin flag plus a per-course role**. That is the
whole model; anything more elaborate you think you remember is from an earlier
version and is gone. This section is the short form for people writing code.
The full matrix is in
[Roles and permissions](../reference/roles-and-permissions.md), and when the
two disagree, that page wins.

- `isAdmin` is global. An admin may act anywhere and bypasses course rosters.
- Every other permission comes from the caller's `Roster.role` in the specific
  course: `FACULTY`, `TA`, or `STUDENT`. **Staff** means `FACULTY` or `TA`,
  which are currently equivalent. Roles resolve fresh from the database on
  every request and never leak across courses. There is no global non-admin
  role, so "is this user a faculty member" is not a well-formed question
  without a course in hand.

Two gates in [`src/lib/permissions.ts`](../../src/lib/permissions.ts):

- `canAccessCourse(user, courseId)` covers reads: admin, or rostered and
  (staff or the course is published). This is the single home of the
  "students only see published courses" rule. Do not re-derive that rule
  inline in a handler; the moment two copies exist, they drift, and the drift
  is a security bug.
- `canManageCourse(user, courseId, roles?)` covers writes and staff-only
  reads: admin, or rostered with a role in `roles` (default
  `COURSE_STAFF_ROLES`, which is FACULTY plus TA; pass `COURSE_FACULTY_ROLES`
  to require FACULTY specifically).

Both exclude archived and soft-deleted courses. An archived course is read-only
for **everyone, admins included**, and **archiving and restoring (un-archiving)
are both admin-only**. A **soft-deleted** course is inaccessible to everyone
(the admin short-circuit is overridden for `deletedAt`, so even an admin is
denied) and `withCourseAuth` masks it as **404** before the role gate runs.

## API conventions

These conventions exist because the failure mode for each is not a broken
feature but a hole. Follow them even when the route feels trivial.

- **Wrap handlers** with `withAdminAuth`, `withCourseAuth`, or
  `withAssignmentAuth`
  ([`src/lib/api/with-auth.ts`](../../src/lib/api/with-auth.ts)) rather than
  hand-rolling auth. The wrappers reject a missing or disabled session with
  401, run the role check, log denials, mask a **soft-deleted** course as 404
  (for everyone, admins included), and (with `blockWhenArchived`) enforce the
  archive freeze, for admins too. A hand-rolled check will get one of those
  things wrong eventually, and the audit log is usually the one
  that gets forgotten. A handful of routes do call `auth()` directly because
  their scoping is self- or entity-based rather than course-param based; that
  is deliberate, not an invitation.
- **Validate bodies** against a Zod schema with `readJson(req, schema)` for
  JSON or `readFormData(req, schema)` for multipart; see
  [Validation](#validation-zod). For date fields a route interprets in a
  specific timezone, use a string-preserving schema. If you let Zod transform
  the datetime to a `Date`, the timezone decision has already been made by the
  time your handler runs, and it was made wrong.
- **Error responses** use `apiError(status, message)`
  ([`src/lib/api/http.ts`](../../src/lib/api/http.ts)), which returns
  `{ error }`. Keep that shape everywhere; the client and the generated API
  types both assume it.
- **Status codes:** 400 for validation, 401 for no or disabled session, 403
  for forbidden, 404 for hidden or missing, 409 for conflict, 413 for too
  large, 429 for rate-limited, and 202 for async (submission and rerun) work.
- **Hide existence from students.** A student hitting a course or assignment
  they cannot reach gets **404**, not 403. A 403 says "this exists and you
  may not have it," which is itself information. Reserve 403 for a rostered
  user who lacks the privilege for a specific action.
- **Never trust client-supplied identity or scope.** Derive the course from
  the assignment or the database, not from the request body, and re-check the
  per-course role in the handler. A body that names its own `courseId` is a
  body that can name someone else's.

## Validation (Zod)

Every form **and** every mutating route validates its input against a **Zod 4**
schema. The "and" is the point: the form schema is a courtesy to the user, the
route schema is the actual gate, and a request from curl never saw the form.

Schemas live in `src/schemas/`, one file per domain (`course.ts`,
`assignment.ts`, `problem.ts`, `user.ts`, `auth.ts`, `bulk.ts`, `grade.ts`,
`group.ts`, `profile.ts`, `password.ts`, `systemSettings.ts`, `log.ts`) plus
[`fields.ts`](../../src/schemas/fields.ts) for reusable field primitives.
There is no barrel; import the specific file.

### Form schema vs API schema

A form and its route deliberately use **different** schemas that share their
field constraints. This looks like duplication until you notice they validate
different shapes:

- **`...FormSchema`** is client-side. It is wired into react-hook-form with
  `zodResolver(schema)` (a few non-RHF dialogs call `schema.safeParse(...)`
  and map the issues onto their own error state). It validates the browser's
  raw input: `datetime-local` **strings**, a confirm-password field, coerced
  number strings.
- **`...ApiSchema`** is server-side, in the route. It validates the wire shape
  the handler actually receives and must avoid browser-only transforms. In
  particular it keeps dates as **strings** so the route can parse them in the
  course timezone (see [Time and deadlines](#time-and-deadlines)).

Both draw their scalar rules from the shared primitives in `fields.ts`
(`dateTimeLocalString`, `formBoolean`, `formBooleanOptional`,
`formIntOptional`, and so on), so the two sides cannot drift on what a valid
value is, only on shape. Do not re-declare a body schema inline in a route
when a domain file exists; import it, or add it there. An inline schema is
invisible to the next person tightening a field constraint, and the API
quietly stops matching the form.

### Validating a route body

Use the helpers in
[`src/lib/api/request.ts`](../../src/lib/api/request.ts):

- `readJson(req, schema)` for JSON bodies.
- `readFormData(req, schema)` for `multipart/form-data` (file uploads). It
  returns the validated scalar fields **and** the raw `FormData`, so the
  handler can still pull the `File`. Multipart values arrive as strings, so
  use the coercing primitives (`formBoolean`, `formIntOptional`) in the
  schema.

Both return a discriminated result and **never throw**: `{ ok: true, data }`
with the typed body, or `{ ok: false, response }`, a ready 400 for malformed
input. The handler stays two lines:

```ts
const parsed = await readJson(req, CourseCreateApiSchema);
if (!parsed.ok) return parsed.response;
const body = parsed.data; // fully typed
```

Every route that reads a body runs it through a schema. A couple keep a custom
raw read for a specific reason (a distinct empty-body message, or an audit-log
entry on a missing field) but still `safeParse` the parsed object against a
schema afterward. The invariant to preserve is that no handler acts on an
unvalidated body, ever.

### Conventions

- **Enums** are `z.enum([...])` literals kept in sync with the Prisma enum by
  a comment. This is deliberately *not* `z.nativeEnum(PrismaEnum)`: these
  schemas are imported by client components, and `z.nativeEnum` would pull
  `@prisma/client` into the browser bundle. The comment is the price of
  keeping Prisma out of the client.
- **Passwords** use the shared `StrongPassword`
  ([`src/schemas/user.ts`](../../src/schemas/user.ts)), which derives its
  rules from `passwordRules` in
  [`src/lib/password-policy.ts`](../../src/lib/password-policy.ts). That file
  is the one source feeding the checklist UI, the `isStrongPassword`
  predicate, and the schema, so a policy change lands in all three at once.
  Length is capped at 72, the bcrypt limit; bytes past it would be silently
  ignored at hash time, which is worse than a validation error.
- **Bound free-text** with `.trim()` and `.max(...)` (names, titles, code).
  Unbounded text fields are a storage and rendering liability.
- Validation is defense in depth. A `...FormSchema` catching bad input in the
  browser does **not** excuse the route; the `...ApiSchema` is the real gate,
  since a non-browser client skips the form entirely.

## Data layer

- The Prisma client ([`src/lib/prisma.ts`](../../src/lib/prisma.ts)) is
  constructed with the pg driver adapter and cached as a dev singleton.
  Standalone scripts (the seed, for example) must build their own client
  **with the adapter**. A bare `new PrismaClient()` cannot connect under
  Prisma 7; there is no engine for it to fall back on.
- **Prefer `select`** to avoid over-fetching, especially on list and hot
  paths, and anywhere a `User` row is loaded. The concrete risk with `User`
  is that a default fetch includes the password hash, and a hash that reaches
  a response object is one careless spread away from a client. Never let one
  get that far.
- **Check-then-act needs a transaction.** A `count` or `findUnique` followed
  by a `create` or `delete` in separate awaits is a race; two concurrent
  requests both pass the check and both write. Where an invariant must hold
  (submission caps, "at least one faculty"), wrap the re-check plus the write
  in a `prisma.$transaction(..., { isolationLevel: Serializable })` and handle
  the serialization conflict (map `P2034` to a 409), or lean on a unique
  constraint plus `upsert` where one exists. See the submission and roster
  routes for the pattern.
- **Batch reads.** Use `findMany({ where: { id: { in: [...] } } })`,
  `include`, or `groupBy` instead of a query per row. N+1 loops are invisible
  on a seed database and painful on a real roster. The calendar, course-list,
  and grade-matrix code are the models to copy.

## Logging

All audit writes go through `createEnhancedActivityLog`. Severity is `INFO`,
`WARNING`, `ERROR`, or `SECURITY`, inferred from the action-name suffix:
`_DENIED` and `_FORBIDDEN` map to `SECURITY`; `_ERROR` to `ERROR`;
`_REJECTED`, `_INVALID`, and `_RATE_LIMIT` to `WARNING`; everything else is
`INFO`. Name your actions accordingly and the severity takes care of itself.

Log every write and every privileged action taken on a student (actor, action,
target, course). Do **not** log a user reading their own routine data; that is
noise, and noise in an audit log is what buries the entry you actually need
during an incident. The log is append-only: no route edits or deletes an
entry, and retention pruning runs as a scheduled job.

## Time and deadlines

Time bugs in an LMS are grade disputes, so the rules here are strict. Store
every timestamp as a **UTC instant**. A course deadline is entered in the
course timezone and converted at save time; store IANA zone names, never fixed
offsets, because a fixed offset is wrong for half the year anywhere with DST.
**Lateness is always computed on the server, UTC against UTC.** The display
zone is the viewer's, resolved as profile override, then browser, then system
default, and it is a display preference only. Never trust a client-supplied
time or timezone for enforcement; a client that controls the clock controls
the deadline.

## Environment

- **`NEXTAUTH_SECRET`** is the JWT signing secret, validated at runtime by
  `requireAuthSecret` (at least 32 chars). The check is skipped during
  `next build`, since there is no secret at build time, but enforced at server
  start and on every edge-proxy request, so a misconfigured deployment fails
  immediately rather than issuing forgeable tokens.
- **`DATABASE_URL`** is the Postgres connection for the app, migrations, and
  seed (read via `prisma.config.ts`).

## Testing and checks

Run before pushing:

- `npx vitest run` runs the full suite. It mocks Prisma; no database needed.
- `npm run typecheck` covers the source, which must stay at **zero errors**;
  `npm run typecheck:test` covers the test files.
- `npm run lint` runs ESLint 9 flat config with type-aware rules, plus the
  TanStack Query key-hygiene plugin. CI runs it with `--max-warnings=0`, so a
  warning locally is a failure remotely.
- `npm run docs` regenerates the OpenAPI spec and the typed API client
  (`src/types/api.ts`); CI fails if the committed types drift, so run it after
  any route change.

> One asymmetry to know about: `next build` does stricter type-checking than
> `tsc` (against Next's generated route types) and only runs in the
> Docker/GHCR publish, not in CI's test job. A build-time-only breakage can
> therefore pass CI and fail the image build. The publish is gated on CI, so
> it fails loudly rather than shipping a broken image, but you find out later
> than you would like.

## CI/CD

- **`ci.yml`** runs on every push to `main` and every PR: `lint`, `test`, and
  `docs-check` in parallel.
- **`docs.yml`** publishes the API reference to GitHub Pages on `main`.
- **`publish-ghcr.yml`** builds and publishes the Docker image to GHCR. It is
  triggered by `workflow_run` **after CI succeeds** on `main`, so a failing
  check never ships an image. It also pins `docker-compose.yml` to the
  published digest, which is why production deploys are reproducible.

Required status-check names are `CI / lint`, `CI / test`, and `CI / docs-check`.
