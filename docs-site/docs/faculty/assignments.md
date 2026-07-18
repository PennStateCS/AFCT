# Assignments

The **Assignments** page contains the work students complete in a course. An assignment holds its own instructions and deadline, plus one or more problems from the course problem bank.

## Create an assignment

1. Open the course and select **Assignments**.
2. Select **Create Assignment**.
3. Enter a title and optional description.
4. Set the due date and time. AFCT interprets this value in the course timezone.
5. Turn on **Group Assignment** if problem availability should be assigned by course group.
6. Choose whether to **Publish Now**.
7. If you accept late work, turn on **Allow Late Submissions** and set a late cutoff.
8. Select **Create Assignment**.

The late cutoff must be at or after the due date. If you do not publish immediately, you can finish adding and checking problems before students see the assignment.

## Add problems

Select the assignment title, then use the **Problems** tab on the assignment page.

- **Create Problem** creates a new problem in the course bank and adds it to this assignment.
- **Add Existing Problem** reuses a problem that is already in the course bank.

For a group assignment, a problem can be available to every group or assigned to a specific course group. Set up the groups first on the [Groups](groups.md) page.

In the current implementation, group mode controls which problems appear for a selected student's group. Submissions, grades, and discussions in the normal course workflow remain attached to the selected student rather than being copied automatically to every group member.

Each problem has settings for this assignment:

- **Max Points** controls how much the problem contributes to the assignment grade.
- **Max Submissions** can be a fixed number or unlimited.
- **Automatic Grading** controls whether AFCT sends submissions for that problem to the autograder.

These assignment settings can differ from the defaults in the problem bank. Removing a problem from an assignment does not delete it from the course.

## Review the assignment list

The table shows the due date, total points, number of problems, late-work settings, submission and comment counts, and publication status. Select an assignment title or choose **Manage**, then **View Assignment**, to open it.

Use the **Published** switch to show or hide an assignment. AFCT asks for confirmation before applying the change.

## Edit or delete an assignment

Open **Manage** for an assignment to edit or delete it.

Keep these safeguards in mind:

- You cannot change an assignment between individual and group mode after a student has submitted work.
- You cannot unpublish an assignment after it has submissions or grades.
- You cannot delete an assignment after it has submissions or discussion comments.
- An archived course is read-only.

When students begin working, use the assignment's [Submissions](submissions.md) tab to review files, rerun the autograder, discuss a problem, and enter grades.
