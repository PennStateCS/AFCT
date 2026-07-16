# Developer guide

**Audience:** engineers working on the AFCT Dashboard

This guide covers the conventions that affect correctness, security, and maintainability. Use [Development setup](../setup/development.md) for installation and daily Docker commands.

## Technology stack

- Next.js 16 with the App Router and Turbopack
- React 19
- NextAuth v5 beta with JWT sessions
- Prisma 7 with PostgreSQL and `@prisma/adapter-pg`
- Zod 4
- TanStack Query v5
- Tailwind CSS 4
- Vitest 4
- Node.js 22
- Docker for development and production
- GitHub Container Registry for published images

Prisma 7 does not use a bundled query engine or `datasource.url` in the schema. Every Prisma client, including clients created by standalone scripts, must use the PostgreSQL driver adapter.

## Repository map

| Path | Purpose |
|---|---|
| `src/app/api/**/route.ts` | HTTP route handlers |
| `src/app/**` | Pages, layouts, and client components |
| `src/lib/` | Server logic, authorization, API helpers, auth, Prisma, workers, and shared utilities |
| `src/schemas/` | Zod form and API schemas |
| `prisma/` | Schema, migrations, and seed files |
| `docs/` | User, developer, setup, operations, and reference documentation |

Important shared files include:

- `src/lib/permissions.ts`
- `src/lib/api/with-auth.ts`
- `src/lib/api/request.ts`
- `src/lib/api/http.ts`
- `src/lib/prisma.ts`
- `src/schemas/fields.ts`

## Development workflow

Docker is the supported development path.

Start the stack with:

```bash
npm run docker:dev
```

The startup sequence applies migrations and starts PostgreSQL, the application, nginx, the backup service, and Prisma Studio.

When a migration must be applied to a running stack:

```bash
npm run docker:dev:migrate:deploy
npm run docker:dev:generate
```

Run the generate command when the Prisma client changed.

### Stale dependency volume

Development uses a named `node_modules` volume. Rebuilding the image does not replace the contents of that volume.

After changing dependencies, use:

```bash
npm run docker:dev:down:volumes
npm run docker:dev
```

This removes development volumes, including the database and uploads. For a less destructive package-only repair, follow the instructions in [Development troubleshooting](../setup/development-troubleshooting.md#module-not-found-after-adding-a-package).

## Authorization model

AFCT uses:

- A global `isAdmin` flag
- A per-course `Roster.role` of `FACULTY`, `TA`, or `STUDENT`

There is no global non-administrator role. Ask which course is involved before checking whether a user is Faculty, a TA, or a Student.

Faculty and TAs currently share the same permissions. `COURSE_STAFF_ROLES` contains both roles.

The complete model is in [Roles and permissions](../../docs-site/docs/reference/roles-and-permissions.md). That page is authoritative.

### Course access helpers

Use the helpers in `src/lib/permissions.ts`.

`canAccessCourse(user, courseId)` handles course reads. It allows:

- Administrators
- Course staff on the roster
- Enrolled students when the course is published

`canManageCourse(user, courseId, roles?)` handles writes and staff-only reads. It allows:

- Administrators
- Rostered users with one of the requested roles

The default role set is `COURSE_STAFF_ROLES`. Pass `COURSE_FACULTY_ROLES` when an action must require Faculty.

Both helpers enforce course lifecycle rules. Archived courses are read-only for everyone. Soft-deleted courses are inaccessible to everyone.

Do not repeat publication and roster rules inside route handlers. Centralized checks reduce authorization drift.

## Route authorization

Use the wrappers in [`src/lib/api/with-auth.ts`](../../src/lib/api/with-auth.ts):

- `withAdminAuth`
- `withCourseAuth`
- `withAssignmentAuth`

The wrappers handle the session, disabled users, role checks, audit logging, archived-course restrictions, and soft-deleted resource hiding.

Some self-scoped or entity-scoped routes call `auth()` directly. Treat those as exceptions that require an explicit reason.

## Request validation

Every mutating route must validate its input with Zod.

Use the helpers in [`src/lib/api/request.ts`](../../src/lib/api/request.ts):

- `readJson(req, schema)` for JSON
- `readFormData(req, schema)` for multipart data

Both return a discriminated result:

```ts
const parsed = await readJson(req, CourseCreateApiSchema);
if (!parsed.ok) return parsed.response;

const body = parsed.data;
```

The helpers return a ready `400` response instead of throwing.

### Form schemas and API schemas

Forms and routes validate different input shapes.

- `...FormSchema` validates browser input such as `datetime-local` strings, number fields, and confirmation fields.
- `...ApiSchema` validates the wire format received by the route.

Both should reuse field constraints from `src/schemas/fields.ts`.

Keep route date values as strings until the handler parses them in the course timezone. Transforming them to `Date` inside the schema can apply the wrong timezone too early.

Do not define an inline route schema when the domain already has a schema file.

### Schema conventions

- Use `z.enum([...])` literals for enums imported by client code. Do not pull Prisma enums into the browser bundle.
- Use the shared `StrongPassword` schema and password policy.
- Cap passwords at 72 characters because bcrypt ignores bytes beyond that limit.
- Use `.trim()` and `.max(...)` for free-text fields.
- Treat client validation as usability. Server validation remains the security boundary.

## API responses

Use `apiError(status, message)` from `src/lib/api/http.ts`. Error bodies must keep this shape:

```json
{ "error": "Message" }
```

Use status codes consistently:

| Status | Meaning |
|---:|---|
| `400` | Invalid request |
| `401` | Missing, expired, or disabled session |
| `403` | Authenticated user lacks permission for a known resource |
| `404` | Missing or intentionally hidden resource |
| `409` | State conflict |
| `413` | Request or file too large |
| `429` | Rate limited |
| `202` | Asynchronous work accepted |

Students should receive `404` for courses and assignments they cannot access. This prevents the API from confirming that a hidden resource exists.

Never trust identity or scope from the request body. Derive the course from the assignment or another authoritative database relation.

## Data access

The shared Prisma client in [`src/lib/prisma.ts`](../../src/lib/prisma.ts) uses the PostgreSQL driver adapter and a development singleton.

Standalone scripts must create their Prisma client with the same adapter. A bare `new PrismaClient()` cannot connect under Prisma 7.

### Select only needed fields

Prefer `select`, especially on list routes and any query that loads a `User`.

A full `User` query includes the password hash. Keep that field out of response-shaped objects entirely.

### Protect check-then-write operations

A read followed by a write can race with another request.

When an invariant must hold, place the final check and write in a serializable transaction:

```ts
await prisma.$transaction(
  async (tx) => {
    // Re-check the invariant and write using tx.
  },
  { isolationLevel: "Serializable" },
);
```

Handle Prisma `P2034` as a conflict, usually `409`.

Use database uniqueness and `upsert` when the data model already provides the necessary constraint.

### Avoid N+1 queries

Use:

- `findMany` with `in`
- `include`
- `groupBy`
- Batched lookup maps

Do not run a query for each row in a loop.

## Audit logging

Use `createEnhancedActivityLog` for audit entries.

Severity is inferred from action suffixes:

| Suffix | Severity |
|---|---|
| `_DENIED`, `_FORBIDDEN` | `SECURITY` |
| `_ERROR` | `ERROR` |
| `_REJECTED`, `_INVALID`, `_RATE_LIMIT` | `WARNING` |
| Other | `INFO` |

Log writes, privileged student actions, and security denials. Include the actor, action, target, and course when available.

Do not log routine reads of a user's own data. Excessive audit noise makes real incidents harder to investigate.

The audit log is append-only. Retention pruning is handled by a scheduled job.

## Dates and deadlines

Store timestamps as UTC instants.

Interpret a course deadline in the course's IANA timezone, convert it once, and store the UTC result. Do not store a fixed offset in place of an IANA timezone because daylight saving rules can change the offset.

The server compares UTC to UTC when determining lateness.

The display timezone is resolved from:

1. User profile setting
2. Browser timezone
3. System default

A display timezone must never affect deadline enforcement.

## Environment variables

### `NEXTAUTH_SECRET`

`requireAuthSecret` validates the secret at runtime. It must contain at least 32 characters.

The build step skips the runtime check because production secrets are not available during `next build`. Server startup and edge requests enforce it.

Changing the secret invalidates existing sessions.

### `DATABASE_URL`

This connection string is used by the application, Prisma migrations, and the seed process through `prisma.config.ts`.

## Tests and checks

Run these before pushing:

```bash
npx vitest run
npm run typecheck
npm run typecheck:test
npm run lint
npm run docs
```

- Vitest uses mocked Prisma and does not require a database.
- Source and test type checks should have zero errors.
- CI runs ESLint with `--max-warnings=0`.
- `npm run docs` regenerates the OpenAPI specification and `src/types/api.ts`.

Run `npm run docs` after changing a route. CI fails when generated API artifacts do not match the committed files.

`next build` checks generated Next.js route types more strictly than plain `tsc`. The Docker image build can therefore catch errors that pass the regular type-check job.

## CI and publishing

- `ci.yml` runs lint, tests, and documentation checks on pull requests and pushes to `main`.
- `docs.yml` publishes the generated API reference to GitHub Pages.
- `publish-ghcr.yml` builds and publishes the GHCR image after CI succeeds on `main`.
- The publish workflow pins the production Compose file to the published image digest.

Required status checks are:

- `CI / lint`
- `CI / test`
- `CI / docs-check`
