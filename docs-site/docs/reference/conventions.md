# Engineering conventions

**Audience:** engineers working on AFCT

This page covers the conventions that affect correctness, security, and maintainability. For the branch-and-check workflow, see [Contributing changes](./contributing.md); when the dev stack misbehaves, see [Development troubleshooting](../setup/development-troubleshooting.md).

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
| `docs-site/` | The published documentation site (this site) |

Important shared files include:

- `src/lib/permissions.ts`
- `src/lib/api/with-auth.ts`
- `src/lib/api/request.ts`
- `src/lib/api/http.ts`
- `src/lib/prisma.ts`
- `src/schemas/fields.ts`

### Where a new module in `src/lib/` goes

**Put it flat in `src/lib/`, with a prefix that groups it with its relatives**:
`course-grades.ts`, `assignment-visibility.ts`, `submission-window.ts`. A prefix sorts
next to its siblings in any listing, so you get the grouping without having to decide
where the file belongs.

`api/`, `security/`, `status/`, `lti/`, `rich-description/` and `similarity/` are the only
folders. If your module is not part of one of those, it goes flat. **Adding another folder is a
decision to argue for in review**, not something to do while naming a file.

They exist for two reasons, recorded here so a proposal for a new one has something to be
measured against:

- **It has internals**, at least one module that should not be imported from outside the
  folder. `status/` qualifies: `status/cache.ts` and `status/ip-classify.ts` are used only
  by their sibling collectors.
- **It is a layer, not a domain**, meaning every module in it does the same *kind* of job
  for the whole app, so the folder name is a role rather than a topic. `api/` (request
  handling) and `security/` (authentication machinery) qualify.

Sharing a topic is not a reason. That is what the prefix is for, and it is why the course
helpers are `course-aggregates.ts` and `course-serialize.ts` rather than a `course/`
folder.

Name the module after what it does, not after being a helper. `src/lib/utils.ts` is the
one exception and holds only `cn`: shadcn/ui expects its class merger at `@/lib/utils`,
every vendored component imports it from there, and `npx shadcn add` regenerates that
path. Do not add anything else to it.

Two rules that apply either way:

- **No `index.ts` barrels in `src/lib/`.** A barrel re-exporting a domain would put
  server-only modules (`fs`, `child_process`, `dns`, `tls`) into the same import graph as
  client components, and it defeats tree-shaking. Import the specific module.
- **Moving or renaming a module means sweeping for `vi.mock('...')` too.** Those are
  string literals that nothing type-checks. A mock pointing at a path that no longer
  exists does not fail: the test silently runs against the real implementation and usually
  keeps passing, having quietly stopped testing what it claims to.

## Authorization model

AFCT uses:

- A global `isAdmin` flag
- A per-course `Roster.role` of `FACULTY`, `TA`, or `STUDENT`

There is no global non-administrator role. Ask which course is involved before checking whether a user is Faculty, a TA, or a Student.

Faculty and TAs currently share the same permissions. `COURSE_STAFF_ROLES` contains both roles.

The complete model is in [Roles and permissions](./roles-and-permissions.md). That page is authoritative.

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

Both helpers apply the soft-delete rule: a deleted course is unreachable through them.

**They do not enforce the archive freeze.** `canManageCourse` and `canAccessCourse` never read
`isArchived`. A route that must refuse writes to an archived course opts in with
`blockWhenArchived: true` on its auth wrapper, which answers `409`. Leave it off and your route
will happily write to an archived course. Soft-deleted courses are inaccessible to everyone.

Do not repeat publication and roster rules inside route handlers. Centralized checks reduce authorization drift.

## Route authorization

Use the wrappers in `src/lib/api/with-auth.ts`:

- `withAdminAuth`
- `withCourseAuth`
- `withAssignmentAuth`

The wrappers handle the session, disabled users, role checks, audit logging, archived-course restrictions, and soft-deleted resource hiding.

Some self-scoped or entity-scoped routes call `auth()` directly. Treat those as exceptions that require an explicit reason.

## Request validation

Every mutating route must validate its input with Zod.

Use the helpers in `src/lib/api/request.ts`:

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

The shared Prisma client in `src/lib/prisma.ts` uses the PostgreSQL driver adapter and a development singleton.

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

**Severity and category are required at every call site, and neither is inferred.** Both are a
deliberate classification of what an entry means, and the code will not guess one from the
action name. Under FERPA this log is the record of who touched a student's work, so a denial
filed as `INFO` is a real loss, not a cosmetic one. Pick from:

| Severity   | For                                                             |
| ---------- | --------------------------------------------------------------- |
| `SECURITY` | A denial, a refused privileged action, a lockout                |
| `ERROR`    | Something failed that should have worked                        |
| `WARNING`  | A request rejected as invalid, or rate-limited                   |
| `INFO`     | A normal action worth recording                                  |

There is an `inferSeverity(action)` helper that derives a severity from the action's suffix, but
you have to opt into it by passing `severity: inferSeverity(action)`. Prefer naming the severity
outright.

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

See [Contributing changes](./contributing.md) for the full local-check sequence, including the database test job.

## CI and publishing

- `ci.yml` runs the checks below. Some of them, `lint` and `docs-check` among them, run on pull requests only.
- `docs.yml` publishes the generated API reference to GitHub Pages.
- `publish-ghcr.yml` builds and publishes the GHCR image after CI succeeds on `main`.
- The publish workflow pins the production Compose file to the published image digest.

Seven checks are required before a pull request can merge, named by their job:

- `lint`
- `typecheck`
- `test`
- `test-db`
- `build`
- `docs-check`
- `evaluator`
