# Client API

The native AFCT submission client uses the stable `/api/client/v1` API. It authenticates with a bearer token instead of the browser session cookie.

Breaking contract changes must use a new version prefix, such as `/api/client/v2`.

## Full API reference

The complete, auto-generated **[API Reference](/api-reference/afct-dashboard-api)** documents every AFCT endpoint (both the browser/dashboard API and this client API) with request and response schemas, parameters, and status codes. It is generated from the OpenAPI annotations in the server code, so it always matches the deployed build (run `npm run docs` at the repo root to regenerate it).

This page is the hand-written guide to the stable native-client surface (`/api/client/v1`): how to authenticate, the typical request flow, and the guarantees a client can rely on. Use it for orientation, and the API Reference for the exact shape of each request and response.

## General rules

- **Base URL:** The AFCT server origin, such as `https://afct.example.edu`
- **Authentication:** `Authorization: Bearer <token>`
- **Errors:** Non-success responses use `{ "error": "<message>" }`
- **Rate limits:** A `429` response includes `Retry-After` in seconds
- **Health check:** `/api/health` is outside the versioned client prefix

## Typical client flow

1. Sign in with `POST /api/client/v1/auth/login`.
2. Store the returned token.
3. Validate a stored token with `GET /api/client/v1/auth/me`.
4. Load courses with `GET /api/client/v1/courses`.
5. Load assignments and problems for the selected course.
6. Upload a file with `POST /api/client/v1/submissions`.
7. Poll the submission by ID until it reaches `COMPLETED` or `FAILED`.
8. Revoke the token with `POST /api/client/v1/auth/logout` when the user signs out.

Tokens use a sliding 30-day expiration. An authenticated request extends the expiry, with writes throttled so the database is not updated on every call. Every token also has an absolute 90-day lifetime from the time it was issued. An active client must sign in again when that limit is reached.

The server stores only a SHA-256 hash of the token. The plaintext token is returned once at login, so the client must protect it like a password.

When an authenticated request returns `401`, stop retrying and ask the user to sign in again.

## Authentication

### `POST /api/client/v1/auth/login`

No authentication header is required.

Request:

```json
{
  "email": "student@example.edu",
  "password": "...",
  "deviceName": "lab-pc"
}
```

`deviceName` is optional.

Success response:

```json
{
  "token": "...",
  "expiresAt": "2026-08-10T12:00:00.000Z",
  "user": {
    "id": "...",
    "email": "student@example.edu",
    "firstName": "...",
    "lastName": "..."
  }
}
```

Common failures:

- `400`: Missing or invalid fields
- `401`: Invalid credentials
- `429`: Too many attempts

### `POST /api/client/v1/auth/logout`

Bearer authentication is required. The endpoint revokes the current token.

```json
{ "success": true }
```

Logout is optional, but clients should use it when the user explicitly signs out.

### `GET /api/client/v1/auth/me`

Bearer authentication is required.

Use this endpoint during startup to validate a stored token.

```json
{
  "user": {
    "id": "...",
    "email": "student@example.edu",
    "firstName": "...",
    "lastName": "..."
  },
  "expiresAt": "2026-08-10T12:00:00.000Z"
}
```

Missing, expired, or revoked tokens return `401`.

## Health

### `GET /api/health`

No authentication is required.

```json
{
  "status": "ok",
  "timestamp": "2026-01-10T15:04:05.000Z",
  "uptime": 1234
}
```

Use this endpoint to confirm that the application process is reachable before attempting login. It is a lightweight liveness check and does not test the database. Environment, build, and version details are intentionally excluded from this public response.

## Courses and assignments

### `GET /api/client/v1/courses`

Returns courses visible to the signed-in user.

Visibility depends on the caller's role in each course. An administrator receives every non-archived course, published or not. Course staff (Faculty and TA) receive their assigned courses, published or not. Students receive the published courses they are enrolled in that are currently within the course's start and end dates. Archived courses are always omitted.

```json
{
  "courses": [
    {
      "id": "...",
      "name": "Automata Theory",
      "code": "CMPEN 331",
      "semester": "Fall 2026",
      "timezone": "America/New_York",
      "isPublished": true,
      "isArchived": false,
      "role": "STUDENT"
    }
  ]
}
```

`timezone` is an IANA timezone name.

### `GET /api/client/v1/courses/{courseId}/assignments`

Returns the course's assignments and their problems. Answer files are never included.

Visibility depends on the caller's role in the course. Administrators and course staff (Faculty, TA) receive every assignment, published or not. Students receive only the published assignments they are assigned, and only once past the assignment's available ("unlock") date if one is set.

Each assignment reports `isGroup` (whether it is a group assignment) and, for a group assignment the caller belongs to, `groupName` (the caller's group). `allowLateSubmissions` says whether late work is accepted.

```json
{
  "timezone": "America/New_York",
  "serverTime": "2026-01-10T15:04:05.000Z",
  "assignments": [
    {
      "id": "...",
      "title": "Homework 1",
      "description": "...",
      "dueDate": "2026-01-15T04:59:00.000Z",
      "allowLateSubmissions": false,
      "lateCutoff": null,
      "isGroup": false,
      "groupName": null,
      "problems": [
        {
          "id": "...",
          "title": "DFA for even-length strings",
          "description": "...",
          "type": "FA",
          "maxStates": 5,
          "isDeterministic": true,
          "maxPoints": 10,
          "maxSubmissions": 3,
          "submissionCount": 1,
          "grade": 8,
          "status": "COMPLETED",
          "solved": false
        }
      ]
    }
  ]
}
```

`solved` is `true` once the caller has earned full marks on the problem (see the tree endpoint below for details).

`dueDate`, `lateCutoff`, and `serverTime` are UTC timestamps. Convert deadlines to the returned course timezone for display.

`serverTime` allows the client to display an accurate countdown without trusting the local device clock.

A missing or inaccessible course returns `404`.

### `GET /api/client/v1/tree`

Returns the caller's **entire** course tree in one call: every visible course, each with its assignments, and each assignment with its problems. This lets a client load once and filter locally (for example "upcoming assignments" or "unsolved problems") instead of fetching each course separately. Visibility is identical to the two endpoints above, and answer-key files are never included.

```json
{
  "serverTime": "2026-01-10T15:04:05.000Z",
  "courses": [
    {
      "id": "...",
      "name": "Automata Theory",
      "code": "CMPEN 331",
      "semester": "Fall 2026",
      "timezone": "America/New_York",
      "isPublished": true,
      "isArchived": false,
      "role": "STUDENT",
      "assignments": [
        {
          "id": "...",
          "title": "Homework 1",
          "description": "...",
          "dueDate": "2026-01-15T04:59:00.000Z",
          "unlockAt": null,
          "lateCutoff": null,
          "allowLateSubmissions": false,
          "isGroup": false,
          "groupName": null,
          "problems": [
            {
              "id": "...",
              "title": "DFA for even-length strings",
              "description": "...",
              "type": "FA",
              "maxStates": 5,
              "isDeterministic": true,
              "maxPoints": 10,
              "maxSubmissions": 3,
              "submissionCount": 1,
              "grade": 10,
              "status": "COMPLETED",
              "solved": true
            }
          ]
        }
      ]
    }
  ]
}
```

The course, assignment, and problem fields match the flat endpoints above. `solved` is `true` once the caller has earned full marks on the problem (for a group assignment a groupmate's correct submission counts, since the autograder fans the grade out to every member); a client can use it to offer an "unsolved only" filter without a separate call. Timestamps are UTC; convert to the course `timezone` for display.

The response can be large for an administrator or faculty member who can see many courses; it is intended for the native client's own (typically small, student-scoped) data set. The per-course endpoints above remain available when a narrower fetch is preferred.

## Submissions

### `POST /api/client/v1/submissions`

Bearer authentication and `multipart/form-data` are required.

| Field          | Required                    | Description                                                                     |
| -------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `assignmentId` | Yes                         | Assignment identifier                                                           |
| `problemId`    | Yes                         | Problem identifier                                                              |
| `file`         | No at the HTTP schema level | XML solution file. Native clients should send it for an evaluatable submission. |

Success returns `202 Accepted`:

```json
{
  "submissionId": "...",
  "status": "PENDING"
}
```

Common failures:

- `400`: Missing field, assignment and problem mismatch, or invalid XML
- `403`: Enrollment or date policy rejects the submission
- `404`: Assignment is missing or hidden
- `409`: Submission limit reached, course archived, or concurrent submission conflict
- `413`: File too large
- `429`: Resubmission cooldown active

### `GET /api/client/v1/submissions?assignmentId=...&problemId=...`

Both query parameters are required.

Returns the caller's attempts for one problem, newest first:

```json
{
  "submissions": [
    {
      "id": "...",
      "status": "COMPLETED",
      "correct": true,
      "submittedAt": "2026-01-10T15:00:00.000Z",
      "fileName": "answer.jff",
      "feedback": "accepts \"01\" but should reject it",
      "submittedBy": "Ada Lovelace"
    }
  ]
}
```

`fileName` is the name of the file the student uploaded. `feedback` is the evaluator's witness or counterexample string, and is `null` while the submission is still queued or processing. `submittedBy` is the member who submitted; for a group problem this can be any groupmate, and for an individual problem it is always the caller. This endpoint never returns another student's work.

### `GET /api/client/v1/submissions/{submissionId}`

Returns one submission result.

A student can read their own submission. Course staff can read submissions in courses they manage.

```json
{
  "id": "...",
  "status": "COMPLETED",
  "correct": false,
  "grade": 6,
  "feedback": "accepts \"01\" but should reject it"
}
```

Status values progress through:

1. `PENDING`
2. `PROCESSING`
3. `COMPLETED` or `FAILED`

`correct`, `grade`, and `feedback` remain `null` until evaluation finishes. `feedback` contains the witness string or other evaluator result.

A missing or unauthorized submission returns `404`.

## Implementation notes

- The server derives the course from the assignment. A client-supplied `courseId` is ignored.
- Enrollment, publication, submission limits, cooldowns, and date rules are enforced by the server.
- Invalid bearer tokens are logged as security events. Do not retry them in a loop.
- The native client's update service is separate from this API.
