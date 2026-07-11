# Roles and permissions

This is the reference for who can do what in the AFCT Dashboard. The audience
guides ([admin](guides/admin.md), [faculty and TA](guides/faculty.md),
[student](guides/student.md), [developer](guides/developer.md)) describe each
role's day-to-day work; this page is the single, precise statement of the model
they all build on.

## The model in one paragraph

There is **one global flag and one per-course role**. The global flag is
`isAdmin` (a boolean on the user). Everything else is the caller's role **in a
specific course**, stored in `Roster.role` as one of `FACULTY`, `TA`, or
`STUDENT`. There is **no global "faculty" or "student" role** — a person is
faculty in the course they teach and, entirely independently, could be a student
in a course they take. Roles are resolved fresh from the database on every
request and never leak from one course to another.

> **Historical note.** Earlier versions had a global `role` enum
> (`ADMIN`/`FACULTY`/`TA`/`STUDENT`) on the user. That was removed. Admin is now
> the `isAdmin` boolean; all other authority is per-course. If you see references
> to a global role anywhere, they are out of date.

## Principals

| Principal | How it's determined | Scope |
|---|---|---|
| **Admin** | `user.isAdmin === true` | Global. Can do anything, everywhere. Bypasses course rosters — never needs to be enrolled. |
| **Faculty** | `Roster.role = FACULTY` in a course | That course only. |
| **TA** | `Roster.role = TA` in a course | That course only. **Currently identical to Faculty** within the course (may be split later). |
| **Student** | `Roster.role = STUDENT` in a course | That course only, and only once the course is **published**. Sees only their own data. |
| **Unauthenticated / disabled** | No session, or the account is disabled/deleted/idle-expired | Nothing. Rejected with 401. |

**Course staff** = Faculty **or** TA. Admins count as staff everywhere. A user
holds exactly one role per course (`Roster` is unique on `(courseId, userId)`).

An admin can also be enrolled in a course as faculty (the dev seed's Charles
Xavier is set up this way) — the global admin power and the course role are
independent and both apply.

## The two gates

All course-scoped authorization goes through two helpers in
[`src/lib/permissions.ts`](../src/lib/permissions.ts):

| Helper | Grants when | Used for |
|---|---|---|
| `canAccessCourse(user, courseId)` | admin **or** (rostered **and** (staff **or** the course is published)) | reads of course data |
| `canManageCourse(user, courseId, roles?)` | admin **or** rostered with a role in `roles` (default: staff) | writes and staff-only reads |

Both treat archived and soft-deleted courses as described below. `canAccessCourse`
is the one place the "students only see published courses" rule lives.

## Course lifecycle and visibility

- **Unpublished course:** invisible to students by URL, API, and search alike —
  a student enrolled in an unpublished course gets **404** everywhere until it is
  published. Staff and admins see their courses regardless of publish state.
- **Published course:** visible to its enrolled students.
- **Archived course:** frozen and **read-only for everyone, admins included** —
  no edits to settings, assignments, problems, grades, or roster. Staff and
  admins can still *view* it; students cannot access it at all. The only write
  permitted is **un-archiving, which is admin-only**.
- **Soft-deleted course:** deleting a course stamps `deletedAt` and retains all
  data (recoverable). It disappears from every list and is inaccessible to
  non-admins; admins keep direct-URL access for recovery.

## Resource matrix

Legend: **A** = Admin · **S** = Staff (Faculty or TA in that course) · **Own** =
the student, their own data only · — = not allowed. All rows also require a valid,
non-disabled session; "not while archived" is called out where it applies.

### Courses

| Action | Admin | Staff | Student |
|---|---|---|---|
| View course | A | S | published only |
| Create course | A | — | — |
| Duplicate course (copies settings + assignments + problems, **not** the roster) | A | — | — |
| Delete course (soft delete) | A | — | — |
| Publish / unpublish | A | S (not while archived) | — |
| Archive | A | S (from active) | — |
| Un-archive | **A only** | — | — |
| Edit settings / dates | A | S (not while archived) | — |
| Manage roster / enroll / bulk-enroll | A | S (not while archived) | — |
| Self-enroll by code | n/a | n/a | published + within the enrollment window + correct code |
| Un-enroll self | n/a | n/a | **No** — only staff/admin remove a member |

> Course **creation and duplication are admin-only.** Faculty work within the
> courses an admin creates and assigns them to. Publish and archive are staff
> actions (Faculty *and* TA); un-archive and delete are admin-only.

### Assignments and problems

| Action | Admin | Staff | Student |
|---|---|---|---|
| View assignment / its problems | A | S | assignment published **and** enrolled **and** course published |
| Create / edit / delete assignment | A | S (not while archived) | — |
| Add / configure problems (points, submission cap, autograder) | A | S (not while archived) | — |
| Upload / replace a problem's answer/solution file | A | S (not while archived) | **Never** (upload and download) |

Unpublished assignments are masked as **404** to students. On staff calendars,
unpublished assignments show a **Draft** marker.

### Submissions and grades

| Action | Admin | Staff | Student |
|---|---|---|---|
| Submit to an assignment | test-submit (throwaway) | test-submit (throwaway) | **Own** — enrolled, course + assignment published, within the date window, under the problem's submission cap |
| Resubmit / additional attempt | n/a | n/a | **Own** — only if under the cap; each attempt counts |
| View submissions | A | S (all) | **Own** (own group on a group assignment) |
| Delete a submission | — | — | **No** — submissions are immutable |
| View grades | A | S (all) | **Own** |
| Grade / re-run / override the autograder | A | S (not while archived) | — |
| Export grades | A (all courses) | S (their courses) | **No** |

> **Staff test-submissions are throwaways** — they run the autograder but are
> never counted as student work. **Manual overrides** (including a staff member
> overriding their own grade) are always audit-logged. Grades are shown to
> students **immediately** once the grader finishes; there is no separate
> grade-release step today.

### Files, comments, groups

| Action | Admin | Staff | Student |
|---|---|---|---|
| Download a submission file | A | S (any in the course) | **Own** (own group on a group assignment) |
| Download a problem / solution file | A | S | **Never** — these are answer keys |
| Post a comment | A | S | with course access |
| View comments on a problem | A (all) | S (all) | **Own thread + staff replies** (own group's thread on a group assignment) |
| Delete a comment | A | S | **No** — comments are immutable to students |
| Group assignment: submit / view / grade | A | S (all groups) | **Own group** — any member submits, all members see it |

### People and system administration

| Action | Admin | Staff | Student |
|---|---|---|---|
| Create / delete users, disable, toggle admin, unlock | A | — | — |
| Reset a password | A (anyone) | S — **only a STUDENT enrolled in a course they teach** | — |
| Assign course roles (incl. granting FACULTY/TA) | A | S (within their course) | — |
| See the full roster (names/emails) | A | S | — |
| See classmates' identities / grades / submissions | A | S | **Never** |
| System settings, status, queue tuning, backups | A | — | — |
| View audit logs | A (all) | S (their course only) | — |

> **Roster safety rules.** A course must always keep at least one faculty member —
> removing or demoting the last faculty is refused. A member with submissions
> cannot be removed. Faculty cannot remove or demote another faculty or an admin;
> only an admin can. Un-enrolling **retains** the member's work, which reattaches
> if they are re-enrolled.
>
> **Scoped staff account authority.** Faculty/TAs may reset the password of a
> student in one of their courses and nothing more — they cannot create/delete
> users, toggle admin, act on other staff, or touch a user who isn't their
> student.

## Existence-hiding

When a **student** hits a course or assignment they cannot access (unpublished,
not enrolled, archived, or soft-deleted), the response is **404 Not Found**, the
same as a nonexistent resource — so the API never reveals that a hidden resource
exists. A plain **403** is still used for a rostered, authenticated user who lacks
the privilege for a specific action (for example, a student attempting a
staff-only write in a course they *are* in).
