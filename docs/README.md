# AFCT Dashboard documentation

Everything here supports one of three jobs: using the app, understanding how it works, or
standing up a server. Pick the section that matches what you are doing.

## Using the app

Role guides, one per job. Read yours through once; after that it works as a lookup.

- [Administrator guide](guides/admin.md). Accounts, signup control, the course lifecycle,
  system settings, the submission queue, status, audit, and backups.
- [Faculty and TA guide](guides/faculty.md). Running a course, assignments and problems,
  the roster, grading and feedback, and groups.
- [Student guide](guides/student.md). Joining a course, submitting work, and reading your
  grades and feedback.

## Understanding how it works

Reference material for engineers. You consult these; you do not read them cover to cover.

- [Developer guide](guides/developer.md). The stack, repository layout, the authorization
  model, API and data conventions, logging, time handling, testing, and CI/CD.
- [Roles and permissions](reference/roles-and-permissions.md). The single precise statement
  of who can do what: the global `isAdmin` flag, the per-course roles, and the full
  resource matrix. Every guide above defers to this page on any question of access.
- [Client API](reference/client-api.md). The token-authenticated `/api/client/v1` contract
  the native submission client speaks.

The live HTTP API reference is generated from the route handlers and published to
[GitHub Pages](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/). The raw
[OpenAPI spec](https://pennstatewilkes-barre.github.io/AFCT-Dashboard/openapi.json) imports
straight into Postman, Insomnia, or a client generator.

## Running a server

- [Development setup](setup/development.md). The Docker dev stack, ports, common commands,
  and troubleshooting.
- [Production setup](setup/production.md). Deploying the GHCR image behind nginx with TLS.

## Keeping the docs honest

Treat these as living documents. When a feature changes, update the matching page in the
same commit, so the docs never drift from the product. Access control has exactly one
home, [Roles and permissions](reference/roles-and-permissions.md); link to it rather than
restate a rule that could later change underneath the copy.
