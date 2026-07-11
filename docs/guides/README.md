# AFCT Dashboard documentation

This documentation is split by audience. Pick the guide that matches how you use the system.

| Guide | For | What it covers |
|---|---|---|
| [Administrator guide](admin.md) | System administrators | Accounts, signup control, the course lifecycle, system settings, the submission queue, status, audit, backups, security |
| [Faculty and TA guide](faculty.md) | Instructors and teaching assistants | Running a course, assignments and problems, roster and enrollment, grading and feedback, groups |
| [Student guide](student.md) | Students | Joining a course, finding and submitting work, feedback and grades, groups, profile, sign-in |
| [Developer guide](developer.md) | Engineers | Stack, layout, the authorization model, API/data conventions, logging, time, testing, CI/CD |

There is also a shared reference that all four build on:

| Reference | What it is |
|---|---|
| [Roles and permissions](../role-inheritance.md) | The precise, single statement of who can do what — the global `isAdmin` flag plus per-course `FACULTY` / `TA` / `STUDENT`, and the full resource matrix. |

## How this is organized

Each guide is written for its audience. When a topic needs more depth, we expand that section rather than adding a new page. If you cannot find something, look one level up: an administrator setting mentioned in the faculty guide is explained in full in the administrator guide, and any question of "who is allowed to do this" is answered by the [Roles and permissions](../role-inheritance.md) reference.

## Keeping it current

Treat these as living documents. When a feature changes, update the matching guide in the same change so the docs never drift from the product. The developer guide points to the internal design notes that hold the authoritative detail for engineers.
