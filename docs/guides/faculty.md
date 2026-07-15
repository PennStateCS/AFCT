# Faculty and TA guide

**Audience:** Faculty and teaching assistants

Faculty and TA access is assigned per course. The two roles currently have the same course permissions.

An administrator creates, duplicates, archives, restores, and deletes courses. After a course is assigned to you, course staff manage its content, roster, assignments, grading, and feedback.

See [Roles and permissions](../reference/roles-and-permissions.md) for the complete authorization model.

## Set up a course

You can edit the name, code, semester, credits, dates, timezone, and other course settings for courses assigned to you.

### Publish the course

Publishing makes the course visible to enrolled students. Before publication, students cannot find or open the course, even with a direct link.

Build the course, add the roster, review the assignments, and publish when it is ready.

### Archived courses

An administrator archives a finished course. An archived course is read-only for everyone, including administrators. Faculty and administrators can view it, but students cannot access it.

Ask an administrator to restore a course when changes are required.

## Set dates and timezones

Each course has its own timezone. New courses inherit the server timezone, and course staff can change it.

Dates entered for assignments are interpreted in the course timezone and stored as a single UTC instant. Students see the deadline in both their local timezone and the course timezone.

The server determines whether a submission is late. A student's device clock or timezone does not change deadline enforcement.

## Create assignments

Create an assignment with a due date. You may also allow late submissions.

When late submissions are enabled:

- A late cutoff is required.
- The cutoff must be on or after the due date.

Assignments start unpublished. Publish an assignment only after its problems and answer files have been tested.

## Add and configure problems

For each problem, set:

- Points
- Maximum submissions, or unlimited attempts
- Autograding on or off
- The answer or solution file

Students cannot view or download answer files.

Choose submission limits carefully. Every accepted attempt counts toward the limit.

## Publish, edit, or delete an assignment

Published assignments are visible to students. Unpublished assignments appear as **Draft** to course staff.

Student activity limits later changes:

- An assignment with submissions or grades cannot be unpublished.
- Individual or group mode cannot change after submissions exist.
- An assignment with submissions or comments cannot be deleted.

When a live assignment needs a correction, update it without removing the existing student record.

No course content can be changed while the course is archived.

## Manage the roster

Course staff can:

- Add members
- Remove eligible members
- Assign Faculty, TA, or Student roles
- Enroll one student directly
- Bulk-enroll students
- Share the enrollment code

Self-enrollment works only while the course is published, the enrollment window is open, and the code is correct. Direct enrollment can be used outside the enrollment window.

Removing a student removes course access but retains their work. Re-enrolling the same account reconnects the submissions and grades.

Roster safeguards include:

- Students cannot remove themselves.
- A member with submissions cannot be removed.
- Every course must keep at least one Faculty member.
- Faculty cannot remove or demote another Faculty member or an administrator.

An administrator can resolve roster changes that course staff are not allowed to make.

## Test the autograder

Course staff can submit to their own problems for testing. Staff submissions run through the evaluator but are not counted as student work in grades or reports.

Test each problem before publication. Students see autograder results as soon as evaluation completes.

## Grade and re-run submissions

Course staff can view all submissions and grades in their courses.

You can:

- Override an autograder score
- Re-run one submission
- Re-run all submissions in a course
- Export grades

Every manual score override is recorded in the audit log with the earlier and new values.

Use a full re-run after correcting an answer file or evaluator configuration that affected several submissions.

## Comments and feedback

Comments are private to the student and course staff.

On individual assignments, a student sees only their own thread and staff replies. On group assignments, every member of the group sees the shared thread.

Students cannot delete comments. Course staff and administrators can.

## Reset a student password

Course staff can reset the password for a Student enrolled in one of their courses.

This permission does not apply to Faculty, TAs, administrators, or users outside the course. Administrators can reset any account.

## Group assignments

A group has one shared submission record. Any member can submit, and all members see the files, result, grade, feedback, and comment thread.

Course staff can create groups, assign members, and view every group in the course. Students cannot view another group's work.
