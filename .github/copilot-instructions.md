# Copilot instructions for AFCT Dashboard

## Big picture architecture
- Next.js 15 App Router app: UI routes in [src/app](src/app) and shared UI in [src/components](src/components). API endpoints live under [src/app/api](src/app/api) as route handlers.
- Data access uses Prisma + PostgreSQL. Schema is in [prisma/schema.prisma](prisma/schema.prisma); always use the shared Prisma singleton from [src/lib/prisma.ts](src/lib/prisma.ts) (it enables slow-query logging in dev).
- API handlers typically: `auth()` → validate input (Zod) → Prisma reads/writes → return `NextResponse`. See [src/app/api/courses/route.ts](src/app/api/courses/route.ts) for a full example (transactions + activity log).
- Activity logging is centralized in `createEnhancedActivityLog()` and `ActivityLogQueries` in [src/lib/activity-log-utils.ts](src/lib/activity-log-utils.ts). Prefer those helpers when adding audit trails.

## Auth, roles, and permissions
- Auth is credentials-based Auth.js/NextAuth. Use `auth()` from [src/lib/auth.ts](src/lib/auth.ts) in API routes to enforce access; `session.user.role` is the primary gate.
- Role rules are split between global `Role` and per-course `CourseRole`. See the rules and edge cases in [docs/role-inheritance.md](docs/role-inheritance.md) and helpers in [src/lib/roles.ts](src/lib/roles.ts).

## Domain conventions
- Dates from form inputs should be converted to UTC using `toDateTimeInTimezone()` / `toEndOfDayInTimezone()` in [src/lib/date-utils.ts](src/lib/date-utils.ts).
- Zod validation errors should be returned with `validationResponse()` from [src/lib/zod-error.ts](src/lib/zod-error.ts).
- Upload size limits come from `getSystemUploadLimit()` in [src/lib/upload-limits.ts](src/lib/upload-limits.ts). Files are stored under private/uploads and public/uploads.

## External integrations
- The evaluator runs a Java .jar and optional CFG analyzer binary. Java runner is in [lib/java-runner.js](lib/java-runner.js). The binary location is controlled by `CFGANALYZER_BINARY` and `CFGANALYZER_LIMIT` (see [bin/README.md](bin/README.md)).

## Developer workflows (prefer Docker)
- Preferred dev stack: `npm run docker:dev` (build/run), `npm run docker:dev:detached` (background), `npm run docker:dev:seed`, `npm run docker:dev:migrate`. See [docs/development_setup.md](docs/development_setup.md).
- Non-Docker local dev exists but is not recommended; see [docs/development_setup.md](docs/development_setup.md).
- Tests: `npm test` or `npm run test:watch` (Vitest). Lint: `npm run lint`.
- Prisma: `npm run db:generate`, `npm run db:migrate`, `npm run db:studio` (local); Docker equivalents are under the docker:dev:* scripts in [package.json](package.json).
