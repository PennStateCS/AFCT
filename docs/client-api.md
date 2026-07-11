# Client API (`/api/client/v1`)

The stable, versioned API for the native submission client (the Java app). It's
authenticated with a **bearer token**, not the browser session cookie — so there's
no CSRF, no cookie handling, and no idle-timeout logout. This `v1` contract won't
change out from under a deployed client; breaking changes will ship as `v2`.

- **Base URL:** the server origin, e.g. `https://<host>`.
- **Auth:** send `Authorization: Bearer <token>` on every request except login.
- **Errors:** non-2xx responses are `{ "error": "<message>" }`. A `429` includes a
  `Retry-After` header (seconds).

## Flow

1. `POST /api/client/v1/auth/login` with the user's email + password → a `token`.
2. Store the token; send it as `Authorization: Bearer <token>` on all later calls.
3. `GET /api/client/v1/courses` → pick a course.
4. `GET /api/client/v1/courses/{courseId}/assignments` → pick an assignment + problem.
5. `POST /api/client/v1/submissions` (multipart) → submit the solution file; you get
   back a `submissionId`.
6. Poll `GET /api/client/v1/submissions/{submissionId}` until `status` is `COMPLETED`
   (or `FAILED`), then read `correct` + `feedback` (the witness).
7. `POST /api/client/v1/auth/logout` when done (optional — revokes the token).

A token uses a **sliding 30-day expiry**: every authenticated call renews it, so an
actively-used token stays valid indefinitely and only lapses after ~30 days of no
use. On a `401` from any endpoint, log in again.

## Endpoints

### `POST /api/client/v1/auth/login`
No auth header. JSON body:
```json
{ "email": "student@psu.edu", "password": "…", "deviceName": "lab-pc (optional)" }
```
`200` →
```json
{ "token": "…", "expiresAt": "2026-08-10T12:00:00.000Z",
  "user": { "id": "…", "email": "…", "firstName": "…", "lastName": "…" } }
```
`400` invalid body · `401` bad credentials · `429` too many attempts (`Retry-After`).

### `POST /api/client/v1/auth/logout`
Bearer auth. Revokes the current token. `200` → `{ "success": true }`.

### `GET /api/client/v1/auth/me`
Bearer auth. Whoami / **token check** — `200` → `{ "user": {…} }` if the token is
valid, `401` if it's missing, expired, or revoked. Use it to validate a stored token
(e.g. on client startup) before showing the main UI.

### `GET /api/health`
**No auth.** Simple liveness/health check — `200` →
`{ "status": "ok", "uptime": …, "environment": …, "version": … }`. Use it to confirm
the server is reachable before logging in. (This one isn't under `/api/client/v1`.)

### `GET /api/client/v1/courses`
Bearer auth. The signed-in user's courses — students see only **published** courses,
staff also see their own unpublished ones, and **archived** courses are excluded
(they're read-only and can't be submitted to). `200` →
```json
{ "courses": [ { "id": "…", "name": "…", "code": "CMPEN 331",
                 "semester": "Fall 2025", "isPublished": true,
                 "isArchived": false, "role": "STUDENT" } ] }
```

### `GET /api/client/v1/courses/{courseId}/assignments`
Bearer auth. The course's **published** assignments and their problems, for this
student. The answer-key file is never included. `200` →
```json
{ "assignments": [ {
    "id": "…", "title": "HW 1", "description": "…",
    "dueDate": "2026-01-15T04:59:00.000Z",
    "allowLateSubmissions": false, "lateCutoff": null,
    "problems": [ { "id": "…", "title": "DFA for …", "type": "FA",
                    "maxPoints": 10, "maxSubmissions": 3,
                    "submissionCount": 1, "grade": 8, "status": "COMPLETED" } ]
} ] }
```
`404` if the course isn't found or isn't accessible to the caller.

### `POST /api/client/v1/submissions`
Bearer auth. `multipart/form-data`:

| field | required | notes |
|---|---|---|
| `assignmentId` | yes | |
| `problemId` | yes | |
| `file` | yes | the solution file (XML) |

`202` → `{ "submissionId": "…", "status": "PENDING" }` (the server evaluates it in
the background). Errors: `400` missing/unlinked/invalid-structure · `403` not
enrolled or late-policy rejection · `404` assignment not found · `409` submission
limit reached **or the course is archived** · `413` file too large · `429` resubmit
cooldown (`Retry-After`).

### `GET /api/client/v1/submissions/{submissionId}`
Bearer auth. Poll a submission's result (yours; staff may read anyone's in-course).
`200` →
```json
{ "id": "…", "status": "COMPLETED", "correct": false, "grade": 6,
  "feedback": "accepts \"01\" but should reject it" }
```
- `status`: `PENDING` → `PROCESSING` → `COMPLETED` / `FAILED`.
- `correct`, `grade`, and `feedback` are `null` until evaluation finishes.
- `feedback` is the witness / counterexample string.
- `404` if the submission doesn't exist or isn't visible to you.

## Notes
- The authoritative course is derived from the assignment; a `courseId` form field
  is ignored if sent.
- All authorization (enrollment, publish state, submission caps, late policy) is
  enforced server-side and identical to the web app — the client can't bypass it.
- The client's auto-updater endpoint (`https://www.cs.rit.edu/~afct/client/`) is
  unrelated to this API.
