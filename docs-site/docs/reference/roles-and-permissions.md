# Roles and permissions

This page is the authoritative reference for AFCT access control. The role guides explain common workflows, but this page defines who can perform each action.

## Authorization model

AFCT uses one global flag and one course-specific role.

- `User.isAdmin` grants global administrator access.
- `Roster.role` grants `FACULTY`, `TA`, or `STUDENT` access in one course.
- There is no global Faculty, TA, or Student role.

A person can hold different roles in different courses. An administrator may also have a roster role, but administrator access remains global.

Roles are read from the database for each request.

> Earlier AFCT versions used a global role enum on the user. That model is no longer valid.

## Principals

| Principal | Determined by | Scope |
|---|---|---|
| Administrator | `user.isAdmin === true` | Global |
| Faculty | `Roster.role = FACULTY` | One course |
| TA | `Roster.role = TA` | One course |
| Student | `Roster.role = STUDENT` | One course, after publication |
| Unauthenticated or disabled user | No valid session | No access |

Faculty and TAs currently have the same course permissions. The term **course staff** means Faculty or TA. Administrators count as course staff everywhere.

Each user has at most one roster role in a course because `Roster` is unique on `(courseId, userId)`.

## Course authorization helpers

Course routes use the helpers in [`src/lib/permissions.ts`](https://github.com/PennStateCS/AFCT/blob/main/src/lib/permissions.ts).

| Helper | Access rule | Typical use |
|---|---|---|
| `canAccessCourse(user, courseId)` | Administrator, or rostered user when the user is course staff or the course is published | Course reads |
| `canManageCourse(user, courseId, roles?)` | Administrator, or rostered user with an allowed role | Writes and staff-only reads |

`canManageCourse` uses the course staff roles by default. Pass the Faculty-only role set when an action must exclude TAs.

Archived and soft-deleted courses add the lifecycle restrictions described below.

## Course lifecycle

### Unpublished

Course staff and administrators can view the course. Students receive `404 Not Found`, even when they are enrolled.

### Published

Enrolled students can view the course and its published assignments.

### Archived

The course is read-only for everyone, including administrators. Course staff and administrators can view it. Students cannot access it.

Only administrators can archive or restore a course.

### Deleted

Deletion depends on the course contents:

- An empty course is permanently deleted.
- A course with content, enrollment, or submissions is soft-deleted.

A soft-deleted course retains its records but is hidden from every user, including administrators. Course routes return `404 Not Found`. There is no in-app restore.

## Permission matrix

### Courses

| Action | Administrator | Faculty or TA | Student |
|---|---|---|---|
| View course | Yes | Assigned courses | Published, enrolled courses |
| Create course | Yes | No | No |
| Duplicate course | Yes | No | No |
| Delete course | Yes | No | No |
| Publish or unpublish | Yes | Yes, unless archived | No |
| Archive | Yes | No | No |
| Restore | Yes | No | No |
| Edit settings and dates | Yes | Yes, unless archived | No |
| Manage roster | Yes | Yes, unless archived | No |
| Self-enroll by code | Not applicable | Not applicable | Published course, open enrollment window, valid code |
| Remove self from roster | Not applicable | Not applicable | No |

Course duplication copies settings, assignments, problems, and answer files. It does not copy the roster.

### Assignments and problems

| Action | Administrator | Faculty or TA | Student |
|---|---|---|---|
| View assignment and problems | Yes | Assigned courses | Published assignment in a published enrolled course |
| Create, edit, or delete assignment | Yes | Yes, unless archived | No |
| Configure points, submission limits, and autograding | Yes | Yes, unless archived | No |
| Upload or replace an answer file | Yes | Yes, unless archived | No |
| Download an answer file | Yes | Yes | No |

Unpublished assignments return `404 Not Found` to students. They appear as **Draft** to course staff.

### Submissions and grades

| Action | Administrator | Faculty or TA | Student |
|---|---|---|---|
| Submit | Test submission | Test submission | Own work, within publication, date, enrollment, and attempt rules |
| Submit another attempt | Not applicable | Not applicable | Own work, below the limit |
| View submissions | All | All in assigned course | Own work or own group |
| Delete a submission | No | No | No |
| View grades | All | All in assigned course | Own grades |
| Grade, re-run, or override | Yes | Yes, unless archived | No |
| Export grades | All courses | Assigned courses | No |

Staff test submissions run through the evaluator but do not count as student work.

Manual overrides are recorded in the audit log. Students see results as soon as evaluation finishes. AFCT does not currently have a separate grade-release step.

### Files, comments, and groups

| Action | Administrator | Faculty or TA | Student |
|---|---|---|---|
| Download a submission file | All | All in assigned course | Own work or own group |
| Post a comment | Yes | Yes | With course access |
| View comments | All | All in assigned course | Own thread or own group thread |
| Delete a comment | Yes | Yes | No |
| Group submission and grading | All groups | All groups in assigned course | Own group |

Students never receive answer files.

### Accounts and system administration

| Action | Administrator | Faculty or TA | Student |
|---|---|---|---|
| Create, disable, unlock, or delete accounts | Yes | No | No |
| Grant administrator access | Yes | No | No |
| Reset password | Any account | Student enrolled in an assigned course | No |
| Assign course roles | Any course | Assigned course | No |
| View full roster | Any course | Assigned course | No |
| View classmates' work or grades | Yes | Assigned course | No |
| Manage system settings, status, queue, or backups | Yes | No | No |
| View audit records | All | Assigned-course records | No |

## Roster safeguards

- A course must keep at least one Faculty member.
- A member with submissions cannot be removed.
- Faculty cannot remove or demote another Faculty member or an administrator.
- Removing a student keeps the student's work. Re-enrollment reconnects it.
- Students cannot remove themselves.

## Existence hiding

A student receives `404 Not Found` for a course or assignment that is unpublished, archived, soft-deleted, or outside the student's enrollment.

Use `403 Forbidden` when the user is authenticated and rostered but lacks permission for a specific action in a resource they can otherwise access.
