# Manual smoke tests: assignments, problems, groups

A browser-only pass over the three areas that change most often. Runnable by anyone with
faculty access to a dev course; no shell or database access except where marked.

Automated coverage lives elsewhere and does not replace this:

- `npm test` - unit suite (Prisma mocked)
- `npm run test:db` - real-Postgres behaviour (claim exclusivity, constraints)
- `npm run e2e` - browser smoke suite (see `e2e/README.md`)

## Before you start

Seeded accounts, all with password `password123`:

| Account | Use it for |
| --- | --- |
| `admin@example.com` | System administration |
| `faculty2@example.com` (Bruce Wayne) | **What an instructor can actually do** |
| `student@example.com` (Oliver Green) | Student view |

Do not use `faculty@example.com` to test instructor permissions: the seed also flags that
account `isAdmin`, so it passes checks a real instructor would fail.

**No student file upload exists in the web UI.** Students submit from the JFLAP desktop
client via `POST /api/client/v1/submissions` (bearer token from
`POST /api/client/v1/auth/login`). Steps below marked **⚠** need that client or a `curl`
call and cannot be done from a browser.

Course page is `/dashboard/courses/{courseId}`, with tabs Assignments, Problems, Roster,
Grades, Groups, Activity, Settings. An assignment is
`/dashboard/courses/{courseId}/{assignmentId}` - note there is no `/assignments/` segment.

## Assignments

| # | Steps | Expect |
| --- | --- | --- |
| A1 | Faculty → course → Create Assignment. Fill Title, click Next | Advances. Wizard is Details / Type / Assign To / Review |
| A2 | Finish the wizard, leaving it unpublished | Listed in Assignments with Published = no |
| A3 | As an enrolled student, open the assignment URL directly | **404, not 403.** An unpublished assignment must not be confirmed to exist |
| A4 | Publish it, reload as the student | Now visible |
| A5 | Assign To → specific students, excluding Oliver. View as Oliver | **404** again, masked identically to unpublished |
| A6 | Set a future unlock date. View as an assigned student | Description and problem list hidden, submitting blocked |
| A7 | Same assignment, viewed as faculty | Staff see it and may test-submit before unlock |
| A8 | Give one student a due-date override, check the calendar as that student | Their date, not the base date |
| A9 | Archive the course (Settings), then try to edit the assignment | Rejected. Archived is frozen for staff and admins too |

Run A9 last, or on a throwaway course - archiving is disruptive.

## Problems

| # | Steps | Expect |
| --- | --- | --- |
| P1 | Problems tab → create, upload a `.jff` | Accepted. Allowed: `.txt .fa .pda .cfg .re .jff` |
| P2 | Upload a file whose contents do not match the chosen type | Rejected with a structure error, nothing stored |
| P3 | Create an FA problem | Max States and Deterministic offered |
| P4 | Create a CFG or regex problem | Neither field appears - they are FA/PDA only |
| P5 | Attach one problem to **two** assignments with different points and submission limits | Both stick independently |
| P6 | Set one of them to unlimited submissions | The other assignment's cap is unaffected |
| P7 | Edit a problem and replace its file | New file takes effect; the old one is removed only after the database write commits |
| P8 | Delete a problem that is attached to an assignment | Blocked or warned - problems are shared many-to-many |
| P9 | Upload a file named `../../etc/passwd.jff` | Stored under a generated UUID name; the original is kept as display text only |

P5 is the one to re-check after any change to the problem or assignment model: points,
submission limit and autograder live on the problem↔assignment **association**, not on the
problem, so the same problem can legitimately differ between assignments.

## Groups

| # | Steps | Expect |
| --- | --- | --- |
| G1 | Groups tab → create a group set, add groups, add members | All succeed while the set is unlocked |
| G2 | Random-assign students | Members distributed across groups |
| G3 | Add one student to two groups in the same set | Rejected - one membership per student per set |
| G4 | ⚠ Create a group assignment on that set, have one member submit | Submission is recorded against the group and shared by its members |
| G5 | Now add or remove a group or member in that set | **Blocked.** The set locks on the first submission or grade |
| G6 | Rename the set | Still allowed - the lock covers membership, not naming |
| G7 | Delete that submission, retry G5 | Still blocked. The lock is sticky and never cleared |
| G8 | Delete a group set that an assignment uses | Blocked, with the reason shown |
| G9 | ⚠ Second member submits the same problem where the cap is 1 | Rejected - the cap counts group-wide, not per student |

G7 is the easiest to get wrong when refactoring: removing the submission does **not**
unlock the set, by design, because grades may already have been derived from it.

## Cross-cutting

- **Cap** ⚠ - submit past the limit → 409. Faculty submitting the same problem → exempt.
- **Cooldown** ⚠ - two rapid submissions → 429 with a `Retry-After` header.
- **Late policy** - after due with late off → rejected; late on and cutoff in the future →
  accepted; past the cutoff → rejected.
- **Enrollment** - un-enrol a student who had a due-date override, then re-enrol them. The
  override must be gone, not silently reinstated.
- **Archived course** ⚠ - accepts no submissions from anyone, including admins.
