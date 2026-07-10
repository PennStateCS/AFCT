# Developer guide

Audience: engineers working on the AFCT Dashboard.

## Stack

- Next.js 15 (App Router) with server components and route handlers.
- NextAuth v5 with JWT sessions.
- Prisma 6 against PostgreSQL.
- TanStack Query on the client.
- Vitest for tests.

## Local development

The stack runs in Docker. `npm run docker:dev` builds and starts the app, database, nginx, and Prisma Studio. The app entrypoint applies migrations on start (`MIGRATE_ON_START`), so a fresh start is up to date. To apply a new migration to an already running stack without bouncing the dev server, run `npm run docker:dev:migrate:deploy`, then `npm run docker:dev:generate` if the Prisma client changed. Full setup lives in `development_setup.md` and `production_setup.md`.

## Authorization model

Authorization is a global admin flag plus a per course role.

- `isAdmin` is global. An admin may act anywhere and bypasses course rosters.
- Every other permission comes from the caller's `Roster.role` in the specific course: `FACULTY`, `TA`, or `STUDENT`. Staff means `FACULTY` or `TA`. Roles resolve fresh per request and never leak across courses.

Two gates in `src/lib/permissions.ts`:

- `canAccessCourse(user, courseId)` for reads: admin, or rostered and (staff or the course is published).
- `canManageCourse(user, courseId, roles?)` for writes and staff only reads.

Both exclude archived and soft-deleted courses.

| Actor | Scope | Sees | Can change |
|---|---|---|---|
| Admin | Global | Everything | Everything, except writes to an archived course (only un-archive) |
| Faculty / TA | Their course | All course data | Course content, roster, grades, unless the course is archived |
| Student | Their course, if published | Own data only | Own submissions, within the submission rules |

The exhaustive matrix and its edge cases live in the internal design notes (`route-authorization.md` in `docs/`).

## API conventions

- Wrap handlers with `withAdminAuth` or `withCourseAuth` (`src/lib/api/with-auth.ts`) rather than hand rolling auth. They reject a missing session with 401, run the role check, and log denials.
- Error responses use `apiError(status, message)`, which returns `{ error }`.
- Denials (403) log a `SECURITY` event via `logDenial`; operational failures log `ERROR` via `logError`. Both are in `src/lib/api/activity.ts`.
- Status codes: 400 validation, 401 no session, 403 forbidden, 404 hidden or missing.
- Hide existence from students: a student hitting a course or assignment they cannot reach gets 404, not 403.

## Logging

All audit writes go through `createEnhancedActivityLog`. Severity is `INFO`, `WARNING`, `ERROR`, or `SECURITY`, inferred from the action name suffix. Log every write and every privileged action taken on a student. Do not log a user reading their own routine data. The log is append only. The full policy is in `logging-policy.md` in `docs/`.

## Time and deadlines

Store every timestamp as a UTC instant. A course deadline is entered in the course timezone and converted at save time. Lateness is always computed on the server, UTC against UTC. The display zone is the viewer's, resolved as profile override, then browser, then system default. Never trust a client supplied time for enforcement.

## Testing and checks

Run `npx vitest run`, `npx tsc --noEmit` (source code must stay at zero errors; test files carry known baseline noise), and `npx eslint`. The TanStack Query eslint plugin enforces query key hygiene.
