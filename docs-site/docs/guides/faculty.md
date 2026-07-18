# Faculty and TA guide

**Audience:** Faculty and teaching assistants

Faculty and TA access is assigned separately for each course. Both roles can manage teaching content, assignments, problems, groups, grading, and feedback. Faculty also control roster roles and removals. TAs can enroll students, but they cannot change another member's course role or remove a member.

An administrator creates, duplicates, archives, restores, and deletes courses. After an administrator assigns you to a course, use the Faculty documentation for day-to-day work:

- [Course overview](../faculty/course.md)
- [Course activity](../faculty/activity.md)
- [Assignments](../faculty/assignments.md)
  - [Submissions](../faculty/submissions.md)
- [Problems](../faculty/problems.md)
- [Roster](../faculty/roster.md)
- [Course settings](../faculty/settings.md)
- [Grades](../faculty/grades.md)
- [Groups](../faculty/groups.md)

See [Roles and permissions](../reference/roles-and-permissions.md) when you need the exact authorization rules.

## A practical course workflow

1. Review the course dates, timezone, and enrollment window.
2. Add Faculty, TAs, and students to the roster. TAs can add students, while Faculty handle role changes and removals.
3. Create and test problems before students need them.
4. Build assignments, attach problems, and check points, attempt limits, due dates, and late-work rules.
5. Publish the course and each assignment when they are ready for students.
6. Monitor submissions, comments, grades, and course activity.

New assignments are unpublished by default, although the creation form also offers **Publish Now**. Students cannot see unpublished courses or assignments.

## Deadlines and archived courses

AFCT interprets assignment dates in the course timezone and stores them as UTC instants. Students see both their effective timezone and the course timezone when those differ. The server, not the student's device clock, decides whether work is late.

Only an administrator can archive or restore a course. An archived course is read-only, including for administrators and course staff, and students cannot open it.

## Testing and grading

Faculty and TAs can make test submissions to problems they teach. Staff can review course submissions, override grades, rerun one submission, or rerun the visible submissions from an assignment workspace. AFCT records manual grade changes in the activity log.

The grade export API accepts Faculty and TA access, but the current course page shows the **Export Grades** button only to system administrators. Ask an administrator for an export when the button is not available.

Password resets are also handled from the administrator-only **User Accounts** page.
