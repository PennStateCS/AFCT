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

Edit the title and description.

### Type

Shows whether the assignment is individual or group, and for a group its group set. You can switch the type here (see [Type](#type-individual-or-group) above for what a switch resets).

### Assign To

The same audience selector and default schedule as the create wizard, plus a **Date overrides** section for giving one student or group different dates.

To add an override, use **Add override** and pick an assigned target - only students or groups that are actually assigned this assignment are listed. A row appears where you can set any of **Available from**, **Due**, **Late submissions**, and **Accept until**. Any field you leave blank inherits the default schedule, so you can change only the due date and keep the rest. Remove a row to drop the override; the target falls back to the default schedule.

Select **Save changes** to apply your edits to the audience, schedule, and overrides together.

### Problems

- **Create Problem** creates a new problem in the problem bank and adds it to this assignment.
- **Add Existing Problem** reuses a problem already in the problem bank.

Each problem has per-assignment settings:

- **Max Points** controls how much the problem contributes to the assignment grade.
- **Max Submissions** can be a fixed number or unlimited.
- **Automatic Grading** controls whether AFCT sends submissions for that problem to the autograder.

These settings can differ from the defaults in the problem bank. Every assigned student (or group) gets the same set of problems. Removing a problem from an assignment does not delete it from the course.

### Submissions

Once students begin working, use the **Submissions** tab to review files, rerun the autograder, discuss a problem, and enter grades. See [Submissions](submissions.md).

### Statistics

The **Statistics** tab gives you an at-a-glance read on how the class is doing on this assignment. It is visible to course staff (faculty and TAs) and admins only, never to students. An individual assignment is measured in students; a group assignment is measured in groups, and the tab says which.

Near the heading it shows the normal due date and how many participants have a due-date exception. Below that are several charts:

- **Assignment score distribution** - a histogram of final assignment percentages (total earned points over total possible), in 10-point ranges. Only fully graded work is included; the card notes how many were left out as incomplete or ungraded, and marks the mean and median.
- **Submission status** - one bar per problem showing where each participant's latest submission sits in the evaluation queue: **Completed** (evaluated), **Processing** (being evaluated now), **Pending** (queued, waiting for the autograder), **Failed** (evaluation errored), and **Missing** (no submission yet). This tracks the grading pipeline, so a problem someone has not submitted shows as Missing regardless of the due date.
- **Attempts to solve** - how many submissions participants needed before their first correct one, bucketed 1 to 5+. Participants who submitted but never solved a problem are excluded and counted separately.
- **First-attempt success** - for each problem, the share of participants who got it right on their very first submission.
- **Submissions over time** - submissions per day, with the due date marked, so you can see how work clusters around the deadline.
- **Problem performance** - a box plot per problem on a shared 0-100% scale, showing the median, middle 50%, whiskers, and any outliers, so you can see which problems were hardest.
- **When work happens** - a day-of-week by hour heatmap of when submissions arrive (in course time).

Each chart has a matching data table for screen readers, and the figures update as more work is submitted and graded.

### Similarity

The **Similarity** tab is a placeholder for upcoming work that will compare student submissions against each other to help review for possible plagiarism. It is staff-only like Statistics.

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
