# Assignments

The **Assignments** page contains the work students complete in a course. An assignment holds its own instructions, an availability window and deadline, and one or more problems from the course problem bank. One assignment can have different due dates for different students.

## Create an assignment

Select **Create Assignment** to open the wizard. It has four steps.

1. **Details** - enter a title and optional description.
2. **Assign To** - set who the assignment is for and when it is due (see below).
3. **Options** - choose whether to **Publish Now**, and turn on **Group Assignment** if problem availability should be assigned by course group.
4. **Review** - check the summary, then select **Create Assignment**.

All dates are interpreted in the course timezone. If you do not publish immediately, you can finish adding and checking problems before students see the assignment.

### Assign To and due dates

The **Assign To** step starts with an **Everyone** card that sets the default dates for the whole class:

- **Available from** (optional) - before this time the assignment is locked. Students see that it exists and when it opens, but not its description or problems. Leave it blank to make the assignment available immediately.
- **Due** - the on-time deadline.
- **Allow late submissions** - accept work after the due date.
- **Available until** (optional) - when late submissions are on, this is the last moment late work is accepted. **Leave it blank to accept late submissions with no deadline.** When set, it must be on or after the due date.

**Give a student different dates.** Use **Add a student override** and pick a student. A card appears where you can set that student's own available-from, due date, and late policy. Any field you leave blank inherits the Everyone value, so you can change only the due date and keep the rest. Once an override exists, the base card is relabeled **Everyone else**.

**Assign to specific students only.** Turn off **Assign to everyone in the course** to assign the work to just the students you add. Students who are not added do not see the assignment at all. The dates on the first card become the defaults those students inherit.

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

The table shows the due date, total points, number of problems, late-work settings, submission and comment counts, and publication status.

When an assignment has per-student due dates, the **Due Date** cell shows a **Multiple** badge next to the base date. Select it to see each student's dates in a popover.

Use the **Published** switch to show or hide an assignment. AFCT asks for confirmation before applying the change. Select an assignment title, or choose **Manage** then **View Assignment**, to open it.

## Edit an assignment

Open the assignment and use its **Settings** tab. It holds all of the assignment's settings - title, description, the availability window and due dates, the assign-to targets, and late policy and publication - and saves them in place.

Keep these safeguards in mind:

- You cannot unpublish an assignment after it has submissions or grades.
- You cannot delete an assignment after it has submissions or discussion comments.
- Removing a student from the course also removes any due-date overrides they had.
- An archived course is read-only.

## Group assignments

In the **Assign To** section you can target whole groups as well as individual students. Pick a [group set](groups.md), then add the groups you want to assign. Each group, like each student, can have its own availability window and due dates.

When an assignment is assigned to a group:

- The group shares one submission set per problem. Any member can submit, and every member sees the group's submissions.
- Autograding grades the whole group: each member receives the group's grade, which you can override for an individual student on the [Submissions](submissions.md) tab.
- A student is assigned at most one way per assignment. Adding a group whose member is already assigned individually (or a student who is already in an assigned group) is rejected.

Once a group in the set has submitted work, the group set is locked: you can still rename or duplicate it, but you cannot change its groups or memberships, and you cannot delete a group set that an assignment uses. Plan the groups before students begin submitting.

When students begin working, use the assignment's [Submissions](submissions.md) tab to review files, rerun the autograder, discuss a problem, and enter grades.
