# Client API (`/api/client/v1`)

This is the API the native submission client (the Java app) talks to. It authenticates
with a bearer token instead of the browser session cookie, so there's no CSRF, no
cookie handling, and no idle timeout that logs the client out. The `v1` contract is
stable: a deployed client won't break underneath you, and any breaking change ships as
`v2`.

- **Base URL:** the server origin, for example `https://<host>`.
- **Auth:** send `Authorization: Bearer <token>` on every request except login.
- **Errors:** any non-2xx response is `{ "error": "<message>" }`. A `429` also carries a
  `Retry-After` header, in seconds.

Paths below are written in full. Every one lives under `/api/client/v1` except
`/api/health`, which is the general server health check.

## Typical flow

1. `POST /api/client/v1/auth/login` with the user's email and password. You get back a
   token.
2. Store the token and send it as `Authorization: Bearer <token>` on every later call.
3. `GET /api/client/v1/courses` and let the user pick a course.
4. `GET /api/client/v1/courses/{courseId}/assignments` and let them pick an assignment
   and a problem.
5. `POST /api/client/v1/submissions` (multipart) to upload the solution file. You get
   back a `submissionId`.
6. Poll `GET /api/client/v1/submissions/{submissionId}` until `status` is `COMPLETED` or
   `FAILED`, then show `correct` and `feedback`.
7. `POST /api/client/v1/auth/logout` when the user signs out. This is optional; it
   revokes the token.

A token has a sliding 30-day expiry. Every authenticated call pushes the expiry out
again, so a token in regular use stays valid indefinitely and only lapses after about 30
days of inactivity. If any call returns `401`, have the user log in again.

## Endpoints

### `POST /api/client/v1/auth/login`
No auth header. JSON body:
```json
{ "email": "student@psu.edu", "password": "...", "deviceName": "lab-pc" }
```
`deviceName` is optional. It's just a label that helps identify the token later. On
success (200):
```json
{ "token": "...", "expiresAt": "2026-08-10T12:00:00.000Z",
  "user": { "id": "...", "email": "...", "firstName": "...", "lastName": "..." } }
```
Failures: `400` if the body is missing fields, `401` for bad credentials, `429` if there
have been too many attempts (respect `Retry-After`).

### `POST /api/client/v1/auth/logout`
Bearer auth. Revokes the token you sent. Returns `{ "success": true }`.

### `GET /api/client/v1/auth/me`
Bearer auth. Doubles as a token check. When the token is valid you get `200` with the
user and the token's expiry:
```json
{ "user": { "id": "...", "email": "...", "firstName": "...", "lastName": "..." },
  "expiresAt": "2026-08-10T12:00:00.000Z" }
```
A missing, expired, or revoked token returns `401`. Call this on startup to find out
whether a stored token is still good.

### `GET /api/health`
No auth. A plain liveness check:
```json
{ "status": "ok", "uptime": 1234, "environment": "production", "version": "1.0.0" }
```
Use it to confirm the server is reachable before you try to log in. Note that this one
lives at `/api/health`, not under the `/api/client/v1` prefix.

### `GET /api/client/v1/courses`
Bearer auth. The courses the signed-in user can see. Students get only published
courses; staff also see their own unpublished ones. Archived courses are left out
entirely, since they're read-only and can't be submitted to.
```json
{ "courses": [ { "id": "...", "name": "Automata Theory", "code": "CMPEN 331",
                 "semester": "Fall 2025", "timezone": "America/New_York",
                 "isPublished": true, "isArchived": false, "role": "STUDENT" } ] }
```
`timezone` is the IANA zone the course's deadlines are anchored to. Render its due dates
in this zone.

### `GET /api/client/v1/courses/{courseId}/assignments`
Bearer auth. The course's published assignments and their problems, scoped to this
student. The answer-key file is never included.
```json
{ "timezone": "America/New_York",
  "serverTime": "2026-01-10T15:04:05.000Z",
  "assignments": [ {
    "id": "...", "title": "HW 1", "description": "...",
    "dueDate": "2026-01-15T04:59:00.000Z",
    "allowLateSubmissions": false, "lateCutoff": null,
    "problems": [ { "id": "...", "title": "DFA for even-length strings", "type": "FA",
                    "maxPoints": 10, "maxSubmissions": 3,
                    "submissionCount": 1, "grade": 8, "status": "COMPLETED" } ]
  } ] }
```
`dueDate` and `lateCutoff` are UTC, so convert them into `timezone` for display.
`serverTime` is the server's current clock (also UTC), which lets you run an accurate
countdown without trusting the client machine's clock. Returns `404` if the course
doesn't exist or the caller can't access it.

### `POST /api/client/v1/submissions`
Bearer auth, `multipart/form-data`:

| field | required | notes |
|---|---|---|
| `assignmentId` | yes | |
| `problemId` | yes | |
| `file` | yes | the solution file (XML) |

On success you get `202`, and the server evaluates the file in the background:
```json
{ "submissionId": "...", "status": "PENDING" }
```
Things that can go wrong:
- `400` a field is missing, the problem isn't linked to the assignment, or the XML
  doesn't parse.
- `403` the student isn't enrolled, or the late policy rejects the submission.
- `404` the assignment doesn't exist.
- `409` the per-problem submission limit is reached, or the course is archived.
- `413` the file is too large.
- `429` the resubmit cooldown is still active (respect `Retry-After`).

### `GET /api/client/v1/submissions?assignmentId=...&problemId=...`
Bearer auth. The caller's own attempts at one problem, newest first. Both query params
are required.
```json
{ "submissions": [ { "id": "...", "status": "COMPLETED", "correct": true,
                     "submittedAt": "2026-01-10T15:00:00.000Z" } ] }
```
This only ever returns the caller's own work. To get the full result for a single
attempt (grade and witness), use the by-id endpoint below. Returns `400` if either query
param is missing.

### `GET /api/client/v1/submissions/{submissionId}`
Bearer auth. The result of one submission. A student can read their own; staff can read
anyone's in a course they run.
```json
{ "id": "...", "status": "COMPLETED", "correct": false, "grade": 6,
  "feedback": "accepts \"01\" but should reject it" }
```
- `status` moves through `PENDING`, then `PROCESSING`, then `COMPLETED` or `FAILED`.
- `correct`, `grade`, and `feedback` are `null` until evaluation finishes.
- `feedback` is the witness string, a counterexample the grader found.
- `404` if the submission doesn't exist or isn't yours to see.

## Notes

- The course a submission belongs to is derived from the assignment. If you send a
  `courseId` form field, it's ignored.
- Every authorization check (enrollment, publish state, submission caps, late policy)
  runs server-side and matches the web app exactly. The client can't relax any of it.
- Requests that carry an invalid bearer token are logged as a security event, so don't
  retry a rejected token in a loop. Have the user log in again instead.
- The client's auto-updater at `https://www.cs.rit.edu/~afct/client/` is a separate
  thing and has nothing to do with this API.
