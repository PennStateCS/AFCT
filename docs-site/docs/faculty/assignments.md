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
- **Group** - tied to one group set; students submit and are graded together as their group. A student who is in no group of that set still gets the assignment while the audience is **All groups**, and submits alone with their own attempt count. Pick specific groups instead if the work should reach only students who have a group.

You set the type when you create the assignment, and you can change it later on the assignment's **Type** tab. Switching between individual and group resets who the assignment is for (back to everyone) and removes any date overrides, so you rebuild those afterward on **Assign To**. The app asks you to confirm before applying the change.

### Assign To and the schedule

**Assign To** - by default the assignment goes to **All students** (individual) or **All groups** in the set (group). Use **Edit students** / **Edit groups** to pick a specific subset instead; anyone not selected does not see the assignment at all. Group targets always come from the assignment's single group set.

The default schedule applies to everyone assigned unless a target has an override:

- **Available from** (optional) - before this time the assignment is locked. Students see that it exists and when it opens, but not its description or problems. Leave it blank to make the assignment available immediately.
- **Due** - the on-time deadline.
- **Allow late submissions** - accept work after the due date.
- **Accept until** (optional) - when late submissions are on, the last moment late work is accepted. Leave it blank to accept late work with no deadline; when set, it must be on or after the due date.

## The assignment page

Open an assignment by selecting its title, or **Manage > View Assignment**. A badge in the
header says whether it is a group or an individual assignment, and a quick-jump beside it moves
you to another assignment in the course without leaving the tab you are on.

There are eight tabs. The first five are where you set the assignment up; the last three are
where you look at what students have done.

### Details

The assignment's title and description. The description accepts headings, formatting, equations
and links, all covered in [Formatted descriptions](descriptions.md).

### Type

Whether the assignment is individual or group, and for a group assignment which group set it
runs in. **Change type** switches it.

Switching resets who the assignment is for, back to everyone, and removes any date overrides, so
rebuild those on **Assign To** afterwards. AFCT asks you to confirm first.

### Assign To

The audience, the default schedule, and per-target date overrides. The audience and schedule
fields are the same ones the create wizard showed you.

Below them, **Date overrides** gives one student or one group different dates from everyone
else. Select **Add override** and pick a target; only students or groups actually assigned this
assignment are offered. A row appears with four fields:

- **Available from**, **Due** and **Accept until** are blank by default, and a blank field
  inherits the default schedule. So you can change only the due date and leave the rest alone.
- **Late submissions** is a choice rather than a blank: **Use default**, **Allow late
  submissions**, or **Close at due date**. The last one is worth knowing about, because it lets
  you close late work for one student on an assignment that allows it for everyone else.

Remove a row to drop the override and send that target back to the default schedule.
**Save changes** applies the audience, the schedule and the overrides together.

### Problems

Which problems make up the assignment.

- **Create Problem** makes a new problem in the course problem bank and adds it here.
- **Add Existing Problem** reuses one already in the bank.

Each problem carries its own settings on this assignment, which can differ from the defaults in
the bank. Open a problem's settings to change them:

- **Max Points**: how much the problem contributes to the assignment grade.
- **Accepted Submissions**: a fixed number of attempts, or unlimited. On a
  [group](groups.md) assignment the limit belongs to the group rather than to each member, so a
  limit of 5 means 5 attempts between them and any member's submission spends one.
- **Automatically Graded**: whether submissions go to the autograder. When it is on, a
  submission the autograder marks correct is awarded the maximum points automatically, and one
  it marks incorrect is recorded as **zero** rather than left ungraded.

Every assigned student or group gets the same set of problems. Removing a problem from an
assignment does not delete it from the course.

There is also an installation-wide wait between attempts on the same problem, ten seconds by
default, which an administrator sets in System Settings. On group work the wait is shared by the
group.

### Settings

Grade sync to your LMS, and the list of LMS courses this assignment has been added to, each with
a **Remove**. See [Grades and rosters from your LMS](lms.md). On a course with no LMS connected
there is nothing here to do.

### Submissions

Once students begin working, review files, rerun the autograder, discuss a problem, and enter
grades. See [Submissions](submissions.md).

### Statistics

Staff-only charts summarizing how the class is doing on the assignment: score distribution,
submission status, attempts to solve, and more. See [Statistics](statistics.md).

### Similarity

A staff-only tab for reviewing submissions that may share an origin. See
[Similarity](similarity.md).

## Group assignments

When an assignment is a group assignment:

- Each group shares one submission set per problem. Any member can submit, and every member sees the group's submissions.
- Autograding grades the whole group: each member receives the group's grade, which you can override for an individual student on the [Submissions](submissions.md) tab.

Once a group in the set has submitted work **or been graded**, the group set is locked: you can
still rename or duplicate it, but you cannot change its groups or memberships, and you cannot
delete a group set that an assignment uses. The lock is permanent, so deleting the submission
afterwards does not reopen it. Plan the groups before students begin submitting.

## The assignment list

The table has a column for the title, **Type** (Individual or Group), **Due Date**,
**Available From**, total points, number of problems, **Allow Late**, **Late Cutoff**, and
**Published**. Type, Allow Late and Published each carry a filter, and you can tick more than
one value in any of them.

When an assignment has date overrides, the **Due Date** cell shows a **Multiple** badge next to the base date; select it to see each target's effective dates in a popover.

Use the **Published** switch to show or hide an assignment. AFCT asks for confirmation before applying the change.

### Duplicate an assignment

**Manage > Duplicate Assignment** opens a short wizard to copy an assignment within the same course:

1. **Details** - the title and description start as the original's; edit them or leave them as is.
2. **Problems** - choose what happens to the original's problems:
   - **Don't include problems** - the copy starts empty.
   - **Link the same problems** - both assignments point at the same problems, so editing a problem (including its solution file) changes it in both.
   - **Duplicate the problems** - independent copies are made in this course, each with its own solution file, so editing one does not affect the other.
3. **Review** - a summary before you create it.

The assignment type and all of the Assign To settings (audience, dates, and any date exceptions) are copied from the original and can be changed afterward. The copy is always created **unpublished**, regardless of the original. Submissions and grades are never copied.

### Import an assignment from another course

**Import Assignment** (next to Create Assignment) copies an assignment out of a different course you teach or assist into this one. It is a short wizard:

1. **Source** - pick a course, then an assignment. The course list shows every course where you are faculty or a TA (administrators see all courses), including archived courses. Unpublished draft assignments in the source course can be imported too.
2. **Details** - the title and description start as the source assignment's; edit them or leave them as is.
3. **Problems** - choose whether to **copy the problems into this course** (each problem is copied here with its own solution file, leaving the originals untouched) or **Don't include problems**.
4. **Review** - a summary before you import.

Because audiences, groups, and problems belong to a specific course, an import cannot carry them across. The imported assignment is always created **unpublished**, assigned to **all students**, and as an **individual** assignment; change the audience and type afterward.

Importing a **group** assignment converts it to individual (the wizard flags this), because group sets are specific to each course. Recreate it as a group assignment in the new course once its groups exist.

Its schedule (due date, available-from, and late settings) is copied from the source as a starting point and may be from another term, so review the dates before publishing.

Submissions and grades are never imported. To copy an assignment *within* the same course, use Duplicate instead.

Keep these safeguards in mind:

- You cannot unpublish an assignment after it has submissions or grades.
- You cannot delete an assignment after it has submissions or discussion comments.
- Removing a student from the course also removes any assignee row and date overrides they had.
- An archived course is read-only.
