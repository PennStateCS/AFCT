# Roles and permissions

This page describes the authorization model implemented by the current AFCT routes and interface.

## Authorization model

AFCT combines one global administrator flag with a role on each course roster.

- `User.isAdmin` grants system-wide administrator access.
- `Roster.role` grants `FACULTY`, `TA`, or `STUDENT` access in one course.
- There is no global Faculty, TA, or Student role.

A person can hold different roles in different courses. Each account has at most one role in a course because the roster is unique on `(courseId, userId)`. An administrator may also appear on a course roster, but the administrator flag remains global.

AFCT reads these values from the database when it authorizes a request. Earlier versions used a global role enum on the user record, but that is no longer the active model.

## Role summary

| Principal                      | Scope               | General access                                                                         |
| ------------------------------ | ------------------- | -------------------------------------------------------------------------------------- |
| Administrator                  | Entire system       | All active courses, account administration, system settings, logs, status, and updates |
| Faculty                        | One assigned course | Teaching content, grading, groups, activity, and full roster management                |
| TA                             | One assigned course | Teaching content, grading, groups, activity, and student enrollment                    |
| Student                        | One assigned course | Published course content and their own work                                            |
| Signed-out or inactive account | None                | No authenticated access                                                                |

The term **course staff** means Faculty or TA. The two roles share most teaching permissions, but they are not identical. Faculty can change roster roles and remove eligible members. TAs cannot.

Administrators bypass normal course-role checks, but lifecycle rules still apply. For example, an archived course is read-only even for an administrator.

## Course authorization helpers

Course routes use the helpers in [`src/lib/permissions.ts`](https://github.com/PennStateCS/AFCT/blob/main/src/lib/permissions.ts).

| Helper                                    | Rule                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `canAccessCourse(user, courseId)`         | Allows an administrator, Faculty, or TA. Allows an enrolled student only after the course is published.                         |
| `canManageCourse(user, courseId, roles?)` | Allows an administrator or an enrolled user whose course role is in the supplied role list. The default list is Faculty and TA. |

Routes pass a Faculty-only role list for roster role changes and removals. Routes also add checks for archived, deleted, unpublished, or otherwise protected records.

## Course lifecycle

### Unpublished

Administrators and assigned course staff can open the course. Students receive `404 Not Found`, even when they are enrolled.

### Published

Enrolled students can open the course and its published assignments. Self-enrollment also requires a valid registration code and an open enrollment window.

An administrator or course staff member can publish or unpublish a course. Unpublishing is blocked once submissions or grades exist.

### Archived

Only an administrator can archive or restore a course. Archived courses are read-only for everyone. Administrators and assigned course staff can view them, while students cannot.

AFCT also applies an archive safety check based on the stored course dates and activity.

### Deleted

Only an administrator can delete a course. AFCT permanently deletes an empty course. A course with retained content or activity is soft-deleted instead.

A soft-deleted course remains in the database for record integrity but is hidden from every user, including administrators. Course routes return `404 Not Found`, and there is no restore action in the interface.

## Permission matrix

### Courses and roster

| Action                                | Administrator     | Faculty                     | TA                          | Student                                        |
| ------------------------------------- | ----------------- | --------------------------- | --------------------------- | ---------------------------------------------- |
| View a course                         | Any active course | Assigned course             | Assigned course             | Published and enrolled course                  |
| Create, duplicate, or delete a course | Yes               | No                          | No                          | No                                             |
| Archive or restore a course           | Yes               | No                          | No                          | No                                             |
| Edit settings or publish              | Yes               | Assigned, unarchived course | Assigned, unarchived course | No                                             |
| View the full roster                  | Yes               | Yes                         | Yes                         | No                                             |
| Enroll one student or bulk enroll     | Yes               | Yes                         | Yes                         | No                                             |
| Change a member's course role         | Yes               | Yes                         | No                          | No                                             |
| Remove an eligible roster member      | Yes               | Yes                         | No                          | No                                             |
| Self-enroll with a registration code  | Not needed        | Not needed                  | Not needed                  | When publication and enrollment rules allow it |
| Remove self                           | Not applicable    | No                          | No                          | No                                             |

### Assignments and problems

| Action                                                      | Administrator     | Faculty or TA                                                        | Student                                      |
| ----------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| View an assignment                                          | Any active course | Assigned course                                                      | Published assignment in an accessible course |
| Create or edit an assignment                                | Yes               | Yes, unless archived                                                 | No                                           |
| Delete an assignment                                        | Yes               | Yes, unless archived and only when protected activity does not exist | No                                           |
| Configure problems, points, attempt limits, and autograding | Yes               | Yes, unless archived                                                 | No                                           |
| Upload, replace, or download an answer file                 | Yes               | Yes, unless the write is blocked by archive state                    | No                                           |

Students receive `404 Not Found` for unpublished assignments. Unpublishing is blocked when submissions or grades exist. Changing between individual and group mode is blocked after submissions exist, and deletion is blocked when submissions or comments exist.

### Submissions, grades, comments, and groups

| Action                                    | Administrator        | Faculty or TA        | Student                                                                                           |
| ----------------------------------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| Submit work                               | Test submission      | Test submission      | Own work, subject to publication, date, cooldown, and attempt rules                               |
| View submissions                          | All active courses   | Assigned course      | Own work. A result route can also allow a groupmate when a submission record contains a group ID. |
| Delete a submission                       | No                   | No                   | No                                                                                                |
| View grades                               | All active courses   | Assigned course      | Own grades                                                                                        |
| Override or rerun an evaluation           | Yes                  | Yes, unless archived | No                                                                                                |
| Export grades through the API             | Yes                  | Assigned course      | No                                                                                                |
| Post or view comments                     | All relevant threads | Assigned course      | Own thread                                                                                        |
| Delete a comment                          | Yes                  | Assigned course      | No                                                                                                |
| Manage course groups and problem mappings | Yes                  | Assigned course      | No                                                                                                |

The current course page exposes **Export Grades** only to system administrators, even though the grade export route accepts Faculty and TA access. Staff who do not see the button should ask an administrator for the export.

Manual grade overrides are recorded in the activity log. AFCT does not have a separate grade-release step, so completed evaluation results and later overrides are available to the student through their course view.

Students never receive answer files.

Group mode currently controls problem-to-group mappings in the course interface. The main submission, grade, and discussion workflow remains student-specific. Do not assume that saving one student's grade updates every group member.

### Accounts and administration

| Action                                                    | Administrator | Faculty or TA   | Student |
| --------------------------------------------------------- | ------------- | --------------- | ------- |
| Create, activate, deactivate, or delete accounts          | Yes           | No              | No      |
| Grant administrator access                                | Yes           | No              | No      |
| Reset another account's password                          | Yes           | No              | No      |
| Change own profile name, avatar, or timezone              | Yes           | Yes             | Yes     |
| Change an account email address                           | No interface  | No              | No      |
| Manage system settings, status, logs, backups, or updates | Yes           | No              | No      |
| View course activity                                      | Any course    | Assigned course | No      |

There is no manual account unlock action in the current interface. A temporary lock ends after the configured lockout period. An administrator can reset the password from **User Accounts**.

## Roster safeguards

- Every course must retain at least one Faculty member.
- A non-admin Faculty member cannot remove another Faculty member.
- A roster member with submissions cannot be removed.
- TAs cannot change course roles or remove roster members.
- Students cannot remove themselves.
- Only an administrator can change the system administrator flag.

A Faculty member can change another member's course role, including another Faculty member, as long as the change does not remove the course's last Faculty member.

## Existence hiding

AFCT often returns `404 Not Found` when a student asks for an unpublished, archived, deleted, or otherwise inaccessible course resource. This keeps hidden resources from being disclosed.

Routes use `403 Forbidden` when the signed-in user can know that the resource exists but lacks permission for the requested action.
