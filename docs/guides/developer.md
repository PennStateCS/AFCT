# Developer guide

**Audience:** engineers working on the AFCT Dashboard.

## Stack

- **Next.js 16** (App Router) — server components and route handlers, Turbopack.
- **React 19**.
- **NextAuth v5** (beta) with JWT sessions.
- **Prisma 7** against PostgreSQL, using the **`@prisma/adapter-pg` driver
  adapter** (Prisma 7 has no bundled query engine and no `datasource.url` in the
  schema — the connection comes from the adapter; see below).
- **Zod 4** for validation.
- **TanStack Query v5** on the client.
- **Tailwind CSS 4**.
- **Vitest 4** for tests.
- **Docker** for local and production; images published to GHCR.
- **Node 22** (Docker images and CI).

## Repository layout

- `src/app/api/**/route.ts` — HTTP route handlers (the API surface).
- `src/app/**` — pages and client components.
- `src/lib/` — server logic: `permissions.ts` (the two course gates), `api/`
  (shared route helpers), `prisma.ts` (the client), auth, submission worker, etc.
- `src/schemas/` — Zod schemas for forms and routes, plus `fields.ts` primitives
  (see [Validation](#validation-zod)).
- `prisma/` — schema, migrations, and the seed (`seed.ts` → `seed-dev.ts` /
  `seed-prod.ts`).
- `docs/` — the guides, the `reference/` pages (roles and permissions, client API),
  and the `setup/` deployment guides.

## Local development

The stack runs in Docker. `npm run docker:dev` builds and starts the app,
database, nginx, and Prisma Studio. The app entrypoint applies migrations on start,
so a fresh start is up to date. To apply a new migration to an already-running
stack without bouncing the dev server, run `npm run docker:dev:migrate:deploy`,
then `npm run docker:dev:generate` if the Prisma client changed.

> **Stale dependencies gotcha.** The dev image keeps `node_modules` in a named
> volume that survives `--build`. After a dependency change (a Prisma major, for
> example) clear it: `npm run docker:dev:down:volumes` then `npm run docker:dev`,
> and confirm the versions in the startup log.

Full setup lives in [`setup/development.md`](../setup/development.md) and
[`setup/production.md`](../setup/production.md).

## Authorization model

Authorization is a **global admin flag plus a per-course role**. This is the short
version; the full matrix is in [Roles and permissions](../reference/roles-and-permissions.md).

- `isAdmin` is global. An admin may act anywhere and bypasses course rosters.
- Every other permission comes from the caller's `Roster.role` in the specific
  course: `FACULTY`, `TA`, or `STUDENT`. **Staff** = `FACULTY` or `TA` (currently
  equivalent). Roles resolve fresh per request and never leak across courses.
  There is no global non-admin role.

Two gates in [`src/lib/permissions.ts`](../../src/lib/permissions.ts):

- `canAccessCourse(user, courseId)` — reads: admin, or rostered and (staff or the
  course is published). This is the single home of the "students only see published
  courses" rule.
- `canManageCourse(user, courseId, roles?)` — writes and staff-only reads: admin,
  or rostered with a role in `roles` (default `COURSE_STAFF_ROLES` = FACULTY + TA;
  pass `COURSE_FACULTY_ROLES` to require FACULTY specifically).

Both exclude archived and soft-deleted courses. Archived courses are read-only for
**everyone, admins included**; the only permitted write is admin un-archive.

## API conventions

- **Wrap handlers** with `withAdminAuth`, `withCourseAuth`, or `withAssignmentAuth`
  ([`src/lib/api/with-auth.ts`](../../src/lib/api/with-auth.ts)) rather than
  hand-rolling auth. They reject a missing/disabled session with 401, run the role
  check, log denials, and (with `blockWhenArchived`) enforce the archive freeze —
  for admins too. A handful of routes hand-roll `auth()` because their scoping is
  self- or entity-based rather than course-param based; that is deliberate.
- **Validate bodies** against a Zod schema with `readJson(req, schema)` (JSON) or
  `readFormData(req, schema)` (multipart) — see [Validation](#validation-zod). For
  date fields a route interprets in a specific timezone, use a string-preserving
  schema (don't let Zod transform the datetime to a `Date`).
- **Error responses** use `apiError(status, message)`
  ([`src/lib/api/http.ts`](../../src/lib/api/http.ts)), which returns `{ error }`.
  Keep that shape everywhere.
- **Status codes:** 400 validation · 401 no/disabled session · 403 forbidden ·
  404 hidden or missing · 409 conflict · 413 too large · 429 rate-limited ·
  202 for async (submission/rerun) work.
- **Hide existence from students:** a student hitting a course or assignment they
  cannot reach gets **404**, not 403. A 403 is for a rostered user who lacks the
  privilege for a specific action.
- **Never trust client-supplied identity or scope.** Derive the course from the
  assignment/DB, not from the request body; re-check per-course role in the handler.

## Validation (Zod)

Every form **and** every mutating route validates its input against a **Zod 4**
schema. Schemas live in `src/schemas/`, one file per domain (`course.ts`,
`assignment.ts`, `problem.ts`, `user.ts`, `auth.ts`, `bulk.ts`, `grade.ts`,
`group.ts`, `profile.ts`, `password.ts`, `systemSettings.ts`, `log.ts`) plus
[`fields.ts`](../../src/schemas/fields.ts) for reusable field primitives. There is
no barrel — import the specific file.

### Form schema vs API schema

A form and its route deliberately use **different** schemas that share their field
constraints, because they validate different shapes:

- **`…FormSchema`** — client-side. Wired into react-hook-form with
  `zodResolver(schema)` (a few non-RHF dialogs call `schema.safeParse(...)` and map
  the issues onto their own error state). It validates the browser's raw input:
  `datetime-local` **strings**, a confirm-password field, coerced number strings.
- **`…ApiSchema`** — server-side, in the route. It validates the wire shape the
  handler actually receives and must avoid browser-only transforms — e.g. it keeps
  dates as **strings** so the route can parse them in the course timezone (see
  [Time and deadlines](#time-and-deadlines)).

Both draw their scalar rules from the shared primitives in `fields.ts`
(`dateTimeLocalString`, `formBoolean`, `formBooleanOptional`, `formIntOptional`, …)
so the two sides can't drift. Don't re-declare a body schema inline in a route when
a domain file exists — import it, or add it there.

### Validating a route body

Use the helpers in
[`src/lib/api/request.ts`](../../src/lib/api/request.ts):

- `readJson(req, schema)` — JSON bodies.
- `readFormData(req, schema)` — `multipart/form-data` (file uploads). Returns the
  validated scalar fields **and** the raw `FormData`, so the handler can still pull
  the `File`. Multipart values arrive as strings, so use the coercing primitives
  (`formBoolean`, `formIntOptional`) in the schema.

Both return a discriminated result and **never throw** — `{ ok: true, data }` with
the typed body, or `{ ok: false, response }`, a ready `400` for malformed input:

```ts
const parsed = await readJson(req, CourseCreateApiSchema);
if (!parsed.ok) return parsed.response;
const body = parsed.data; // fully typed
```

Every route that reads a body runs it through a schema. A couple keep a custom raw
read for a specific reason (a distinct empty-body message, or an audit-log entry on
a missing field) but still `safeParse` the parsed object against a schema.

### Conventions

- **Enums** are `z.enum([...])` literals kept in sync with the Prisma enum by a
  comment — deliberately *not* `z.nativeEnum(PrismaEnum)`, because these schemas are
  imported by client components and must not pull `@prisma/client` into the browser
  bundle.
- **Passwords** use the shared `StrongPassword`
  ([`src/schemas/user.ts`](../../src/schemas/user.ts)), which derives its rules from
  `passwordRules` in
  [`src/lib/password-policy.ts`](../../src/lib/password-policy.ts) — one source for
  the checklist UI, the `isStrongPassword` predicate, and the schema — and caps
  length at 72 (the bcrypt limit).
- **Bound free-text** with `.trim()` and `.max(...)` (names, titles, code).
- Validation is defense-in-depth: a `…FormSchema` catching bad input in the browser
  does **not** excuse the route — the `…ApiSchema` is the real gate, since a
  non-browser client skips the form entirely.

## Data layer

- The Prisma client ([`src/lib/prisma.ts`](../../src/lib/prisma.ts)) is
  constructed with the pg driver adapter and cached as a dev singleton. Standalone
  scripts (e.g. the seed) must build their own client **with the adapter** — a bare
  `new PrismaClient()` cannot connect under Prisma 7.
- **Prefer `select`** to avoid over-fetching, especially on list/hot paths and
  anywhere a `User` row is loaded (never let a password hash reach a response).
- **Check-then-act needs a transaction.** A `count`/`findUnique` followed by a
  `create`/`delete` in separate awaits is a race. Where an invariant must hold
  (submission caps, "at least one faculty"), wrap the re-check plus the write in a
  `prisma.$transaction(..., { isolationLevel: Serializable })` and handle the
  serialization conflict (`P2034` → 409); or lean on a unique constraint + `upsert`
  where one exists. See the submission and roster routes for the pattern.
- **Batch reads.** Use `findMany({ where: { id: { in: [...] } } })`, `include`, or
  `groupBy` instead of a query per row. The calendar, course-list, and grade-matrix
  code are the models to copy.

## Logging

All audit writes go through `createEnhancedActivityLog`. Severity is `INFO`,
`WARNING`, `ERROR`, or `SECURITY`, inferred from the action-name suffix: `_DENIED`
/ `_FORBIDDEN` → `SECURITY`; `_ERROR` → `ERROR`; `_REJECTED` / `_INVALID` /
`_RATE_LIMIT` → `WARNING`; everything else → `INFO`. Log every write and every
privileged action taken on a student (actor, action, target, course). Do **not**
log a user reading their own routine data. The log is append-only — no route edits
or deletes an entry, and retention pruning runs as a scheduled job.

## Time and deadlines

Store every timestamp as a **UTC instant**. A course deadline is entered in the
course timezone and converted at save time; store IANA zone names, never fixed
offsets. **Lateness is always computed on the server, UTC against UTC.** The
display zone is the viewer's — resolved as profile override → browser → system
default — and is a display preference only. Never trust a client-supplied time or
timezone for enforcement.

## Environment

- **`NEXTAUTH_SECRET`** — JWT signing secret, validated at runtime (`requireAuthSecret`,
  ≥ 32 chars). The check is skipped during `next build` (no secret at build time)
  but enforced at server start and on every edge-proxy request.
- **`DATABASE_URL`** — Postgres connection for the app, migrations, and seed
  (read via `prisma.config.ts`).

## Testing and checks

Run before pushing:

- `npx vitest run` — the full suite (mocks Prisma; no DB needed).
- `npm run typecheck` — source must stay at **zero errors**; `npm run typecheck:test`
  covers the test files.
- `npm run lint` — ESLint 9 flat config, type-aware rules, plus the TanStack Query
  key-hygiene plugin. CI runs it with `--max-warnings=0`.
- `npm run docs` — regenerates the OpenAPI spec and the typed API client
  (`src/types/api.ts`); CI fails if the committed types drift.

> `next build` does stricter type-checking than `tsc` (against Next's generated
> route types) and only runs in the Docker/GHCR publish, not in CI's test job — a
> build-time-only breakage can pass CI and fail the image build. The publish is
> gated on CI, so it fails loudly rather than shipping a broken image.

## CI/CD

- **`ci.yml`** runs on every push to `main` and every PR: `lint`, `test`, and
  `docs-check` in parallel.
- **`docs.yml`** publishes the API reference to GitHub Pages on `main`.
- **`publish-ghcr.yml`** builds and publishes the Docker image to GHCR — triggered
  by `workflow_run` **after CI succeeds** on `main`, so a failing check never ships
  an image. It also pins `docker-compose.yml` to the published digest.

Required status-check names are `CI / lint`, `CI / test`, and `CI / docs-check`.
