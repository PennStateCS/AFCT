# Roles and permissions

This is the reference for who can do what in the AFCT Dashboard. The audience
guides ([admin](../guides/admin.md), [faculty and TA](../guides/faculty.md),
[student](../guides/student.md), [developer](../guides/developer.md)) describe
each role's day-to-day work; this page is the single, precise statement of the
model they all build on. If a guide and this page ever disagree, this page is
right and the guide has drifted.

## The model in one paragraph

There is **one global flag and one per-course role**. The global flag is
`isAdmin` (a boolean on the user). Everything else is the caller's role **in a
specific course**, stored in `Roster.role` as one of `FACULTY`, `TA`, or
`STUDENT`. There is **no global "faculty" or "student" role**: a person is
faculty in the course they teach and, entirely independently, could be a
student in a course they take. Roles are resolved fresh from the database on
every request and never leak from one course to another.

> **Historical note.** Earlier versions had a global `role` enum
> (`ADMIN`/`FACULTY`/`TA`/`STUDENT`) on the user. That was removed. Admin is
> now the `isAdmin` boolean; all other authority is per-course. Any reference
> to a global role you find, in code comments or old docs, is out of date.

## Principals

| Principal | How it's determined | Scope |
|---|---|---|
| **Admin** | `user.isAdmin === true` | Global. Can do anything, everywhere. Bypasses course rosters and never needs to be enrolled. |
| **Faculty** | `Roster.role = FACULTY` in a course | That course only. |
| **TA** | `Roster.role = TA` in a course | That course only. **Currently identical to Faculty** within the course (may be split later). |
| **Student** | `Roster.role = STUDENT` in a course | That course only, and only once the course is **published**. Sees only their own data. |
| **Unauthenticated / disabled** | No session, or the account is disabled/deleted/idle-expired | Nothing. Rejected with 401. |

**Course staff** means Faculty **or** TA. Admins count as staff everywhere. A
user holds exactly one role per course (`Roster` is unique on
`(courseId, userId)`).

An admin can also be enrolled in a course as faculty; the dev seed's Charles
Xavier is set up this way. The global admin power and the course role are
independent and both apply.

## The two gates

All course-scoped authorization goes through two helpers in
[`src/lib/permissions.ts`](../../src/lib/permissions.ts):

| Helper | Grants when | Used for |
|---|---|---|
| `canAccessCourse(user, courseId)` | admin **or** (rostered **and** (staff **or** the course is published)) | reads of course data |
| `canManageCourse(user, courseId, roles?)` | admin **or** rostered with a role in `roles` (default: staff) | writes and staff-only reads |

Both treat archived and soft-deleted courses as described below.
`canAccessCourse` is the one place the "students only see published courses"
rule lives; nothing else in the codebase should restate it.

## Course lifecycle and visibility

- **Unpublished course:** invisible to students by URL, API, and search alike.
  A student enrolled in an unpublished course gets **404** everywhere until it
  is published. Staff and admins see their courses regardless of publish
  state.
- **Published course:** visible to its enrolled students.
- **Archived course:** frozen and **read-only for everyone, admins included**.
  No edits to settings, assignments, problems, grades, or roster. Staff and
  admins can still *view* it; students cannot access it at all. **Archiving and
  restoring (un-archiving) are both admin-only** — staff can no longer do
  either.
- **Deleted course:** deletion adapts to the course. An **empty** course (no
  assignments, problems, students, or submissions) is **hard-deleted**
  (permanently removed). A course with real content or enrollment is
  **soft-deleted**: it stamps `deletedAt`, retains all data, and disappears from
  every list. A soft-deleted course is **inaccessible to everyone, admins
  included** — no direct-URL access — and is masked as **404** on every
  course-scoped route. Recovery is out-of-band (data layer / backup); there is
  no in-app restore yet.

## Resource matrix

Legend: **A** = Admin; **S** = Staff (Faculty or TA in that course); **Own** =
the student, their own data only; "no" = not allowed. All rows also require a
valid, non-disabled session; "not while archived" is called out where it
applies.

### Courses

| Action | Admin | Staff | Student |
|---|---|---|---|
| View course | A | S | published only |
| Create course | A | no | no |
| Duplicate course (copies settings + assignments + problems, **not** the roster) | A | no | no |
| Delete course (permanent if empty, else soft delete) | A | no | no |
| Publish / unpublish | A | S (not while archived) | no |
| Archive | **A only** | no | no |
| Restore (un-archive) | **A only** | no | no |
| Edit settings / dates | A | S (not while archived) | no |
| Manage roster / enroll / bulk-enroll | A | S (not while archived) | no |
| Self-enroll by code | n/a | n/a | published + within the enrollment window + correct code |
| Un-enroll self | n/a | n/a | **No**; only staff or an admin remove a member |

Course **creation, duplication, archiving, restoring, and deletion are
admin-only**; faculty work within the courses an admin creates and assigns them
to. Publishing is the staff action here, open to Faculty *and* TA. Freezing a
course (archive), thawing it (restore), and deleting it are reserved to admins.

### Assignments and problems

| Action | Admin | Staff | Student |
|---|---|---|---|
| View assignment / its problems | A | S | assignment published **and** enrolled **and** course published |
| Create / edit / delete assignment | A | S (not while archived) | no |
| Add / configure problems (points, submission cap, autograder) | A | S (not while archived) | no |
| Upload / replace a problem's answer/solution file | A | S (not while archived) | **Never** (upload and download) |

Unpublished assignments are masked as **404** to students. On staff calendars,
unpublished assignments show a **Draft** marker.

### Submissions and grades

| Action | Admin | Staff | Student |
|---|---|---|---|
| Submit to an assignment | test-submit (throwaway) | test-submit (throwaway) | **Own**: enrolled, course + assignment published, within the date window, under the problem's submission cap |
| Resubmit / additional attempt | n/a | n/a | **Own**, only if under the cap; each attempt counts |
| View submissions | A | S (all) | **Own** (own group on a group assignment) |
| Delete a submission | no | no | **No**; submissions are immutable |
| View grades | A | S (all) | **Own** |
| Grade / re-run / override the autograder | A | S (not while archived) | no |
| Export grades | A (all courses) | S (their courses) | **No** |

**Staff test-submissions are throwaways**: they run the autograder but are
never counted as student work. **Manual overrides** are always audit-logged,
including a staff member overriding their own grade. Grades are shown to
students **immediately** once the grader finishes; there is no separate
grade-release step today.

### Files, comments, groups

| Action | Admin | Staff | Student |
|---|---|---|---|
| Download a submission file | A | S (any in the course) | **Own** (own group on a group assignment) |
| Download a problem / solution file | A | S | **Never**; these are answer keys |
| Post a comment | A | S | with course access |
| View comments on a problem | A (all) | S (all) | **Own thread + staff replies** (own group's thread on a group assignment) |
| Delete a comment | A | S | **No**; comments are immutable to students |
| Group assignment: submit / view / grade | A | S (all groups) | **Own group**: any member submits, all members see it |

### People and system administration

| Action | Admin | Staff | Student |
|---|---|---|---|
| Create / delete users, disable, toggle admin, unlock | A | no | no |
| Reset a password | A (anyone) | S, **only for a STUDENT enrolled in a course they teach** | no |
| Assign course roles (incl. granting FACULTY/TA) | A | S (within their course) | no |
| See the full roster (names/emails) | A | S | no |
| See classmates' identities / grades / submissions | A | S | **Never** |
| System settings, status, queue tuning, backups | A | no | no |
| View audit logs | A (all) | S (their course only) | no |

**Roster safety rules.** A course must always keep at least one faculty
member; removing or demoting the last faculty is refused. A member with
submissions cannot be removed. Faculty cannot remove or demote another faculty
or an admin; only an admin can. Un-enrolling **retains** the member's work,
which reattaches if they are re-enrolled.

**Scoped staff account authority.** Faculty and TAs may reset the password of
a student in one of their courses and nothing more. They cannot create or
delete users, toggle admin, act on other staff, or touch a user who isn't
their student.

## Existence-hiding

When a **student** hits a course or assignment they cannot access
(unpublished, not enrolled, archived, or soft-deleted), the response is
**404 Not Found**, the same as a nonexistent resource, so the API never
reveals that a hidden resource exists. A plain **403** is still used for a
rostered, authenticated user who lacks the privilege for a specific action;
for example, a student attempting a staff-only write in a course they *are*
in.
