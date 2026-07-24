# Assignments

The **Assignments** page holds the work students complete in a course. An assignment has its own instructions, a schedule (availability window and deadline), and one or more problems from the course problem bank. Every assignment is either **individual** or **group**, can be assigned to everyone or to specific students or groups, and can give individual targets their own dates.

## Create an assignment

Select **Create Assignment** to open the wizard. It has four steps.

1. **Details** - enter a title and optional description.
2. **Type** - choose **Individual** (each student submits and is graded on their own) or **Group** (students submit and are graded together as a group). For a group assignment, pick the [group set](groups.md) it runs in.
3. **Assign To** - choose who it is for and set the default schedule (see below).
4. **Review** - check the summary, then select **Create Assignment**.

All dates are interpreted in the course timezone. New assignments are created **unpublished** so you can add and check problems first, then publish with the **Published** switch when you are ready.

### Type: individual or group

An assignment is one or the other, not a mix:

- **Individual** - assigned to students; each submits on their own.
- **Group** - tied to one group set; students submit and are graded together as their group. A student who is not in any group of that set is not assigned the work.

You set the type when you create the assignment, and you can change it later on the assignment's **Type** tab. Switching between individual and group resets who the assignment is for (back to everyone) and removes any date overrides, so you rebuild those afterward on **Assign To**. The app asks you to confirm before applying the change.

### Assign To and the schedule

**Assign To** - by default the assignment goes to **All students** (individual) or **All groups** in the set (group). Use **Edit students** / **Edit groups** to pick a specific subset instead; anyone not selected does not see the assignment at all. Group targets always come from the assignment's single group set.

The default schedule applies to everyone assigned unless a target has an override:

- **Available from** (optional) - before this time the assignment is locked. Students see that it exists and when it opens, but not its description or problems. Leave it blank to make the assignment available immediately.
- **Due** - the on-time deadline.
- **Allow late submissions** - accept work after the due date.
- **Accept until** (optional) - when late submissions are on, the last moment late work is accepted. Leave it blank to accept late work with no deadline; when set, it must be on or after the due date.

## The assignment page

Open an assignment (select its title, or **Manage → View Assignment**). It has these tabs: **Details**, **Type**, **Assign To**, **Problems**, **Submissions**, **Statistics**, and **Similarity**.

### Details

Edit the assignment's title and description. See [Details](details.md).

### Type

Switch the assignment between individual and group. See [Type](type.md).

### Assign To

Choose the audience, set the default schedule, and add per-target date overrides. See [Assign To](assign-to.md).

### Problems

Add problems to the assignment and set their per-assignment points, submission caps, and autograding. See [Problems](assignment-problems.md).

### Submissions

Once students begin working, use the **Submissions** tab to review files, rerun the autograder, discuss a problem, and enter grades. See [Submissions](submissions.md).

### Statistics

Staff-only charts summarizing how the class is doing on the assignment: score distribution, submission status, attempts to solve, and more. See [Statistics](statistics.md).

### Similarity

A staff-only tab (in progress) for reviewing submissions for possible plagiarism. See [Similarity](similarity.md).

## Group assignments

When an assignment is a group assignment:

- Each group shares one submission set per problem. Any member can submit, and every member sees the group's submissions.
- Autograding grades the whole group: each member receives the group's grade, which you can override for an individual student on the [Submissions](submissions.md) tab.
- Only students who belong to a group in the set are assigned the work.

Once a group in the set has submitted work, the group set is locked: you can still rename or duplicate it, but you cannot change its groups or memberships, and you cannot delete a group set that an assignment uses. Plan the groups before students begin submitting.

## The assignment list

The table shows each assignment's due date, **Type** (Individual or Group), total points, number of problems, late-work settings, submission and comment counts, and publication status. You can filter by type.

When an assignment has date overrides, the **Due Date** cell shows a **Multiple** badge next to the base date; select it to see each target's effective dates in a popover.

Use the **Published** switch to show or hide an assignment. AFCT asks for confirmation before applying the change.

Keep these safeguards in mind:

- You cannot unpublish an assignment after it has submissions or grades.
- You cannot delete an assignment after it has submissions or discussion comments.
- Removing a student from the course also removes any assignee row and date overrides they had.
- An archived course is read-only.
