# Client API

The native AFCT submission client uses the stable `/api/client/v1` API. It authenticates with a bearer token instead of the browser session cookie.

Breaking contract changes must use a new version prefix, such as `/api/client/v2`.

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

Tokens use a sliding 30-day expiration. Each authenticated request extends the expiration. A token expires after about 30 days without use.

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
  "uptime": 1234,
  "environment": "production",
  "version": "1.0.0"
}
```

Use this endpoint to confirm that the server is reachable before attempting login.

## Courses and assignments

### `GET /api/client/v1/courses`

Returns courses visible to the signed-in user.

Students receive published courses in which they are enrolled. Course staff also receive their unpublished courses. Archived courses are omitted.

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

Returns published assignments and their problems for the selected course. Answer files are never included.

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
      "problems": [
        {
          "id": "...",
          "title": "DFA for even-length strings",
          "type": "FA",
          "maxPoints": 10,
          "maxSubmissions": 3,
          "submissionCount": 1,
          "grade": 8,
          "status": "COMPLETED"
        }
      ]
    }
  ]
}
```

`dueDate`, `lateCutoff`, and `serverTime` are UTC timestamps. Convert deadlines to the returned course timezone for display.

`serverTime` allows the client to display an accurate countdown without trusting the local device clock.

A missing or inaccessible course returns `404`.

## Submissions

### `POST /api/client/v1/submissions`

Bearer authentication and `multipart/form-data` are required.

| Field | Required | Description |
|---|---|---|
| `assignmentId` | Yes | Assignment identifier |
| `problemId` | Yes | Problem identifier |
| `file` | Yes | XML solution file |

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
- `409`: Submission limit reached or course archived
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
      "submittedAt": "2026-01-10T15:00:00.000Z"
    }
  ]
}
```

This endpoint never returns another student's work.

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
