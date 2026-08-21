# Your first course

This walks the whole path once: from a freshly installed AFCT to a student submission that comes
back graded. It takes about half an hour, and at the end you will have seen every piece the rest
of the documentation describes in detail.

Do it on a test course before you set up a real one. Everything here is reversible.

**Before you start** you need AFCT installed and the administrator account you created during
installation. If you do not have that yet, begin with [Install AFCT](../setup/production.md).

## 1. Create the course

Only an administrator can create a course. On a new installation that is you, so you are wearing
both hats: administrator for this step, faculty for most of the rest.

Open **Administration → Courses**, select **Create Course**, and fill in the wizard. Two fields
matter more than the others:

- **Timezone.** Every deadline in the course is interpreted in it. Set it to the timezone your
  class actually meets in, not the server's.
- **Start and end dates.** These decide whether the course reads as Upcoming, Open or Closed.

Leave it unpublished for now. An unpublished course is fully usable by you and invisible to
students, which is exactly what you want while you build it.

## 2. Add yourself as faculty

Creating a course does not put you on its roster. Open the course, go to **Roster**, and enrol
yourself as **Faculty**.

This matters more than it looks: administrator and faculty are separate. Administrator runs the
installation, faculty runs a course. Being one does not make you the other.

## 3. Build one problem

Go to **Problems** and select **Create Problem**. The wizard asks for four things:

1. **Details**: a title and a description. Keep the first one simple, for example "Strings ending
   in 01".
2. **Type**: choose **FA** for a finite automaton. It is the quickest type to check by hand.
3. **Answer File**: upload a `.jff` file built in JFLAP that solves the problem correctly.
4. **Review**: confirm and create.

The answer file is what the autograder compares against. Students never see it.

:::tip Making the answer file
Build the automaton in JFLAP and save it. That saved `.jff` is the file you upload here. If you
want to check it behaves the way you expect before committing to it, run it through the
[Evaluator Sandbox](../faculty/evaluator-sandbox.md), which grades two files against each other
with no course or student involved.
:::

## 4. Create an assignment and put the problem in it

Go to **Assignments** and select **Create Assignment**. The wizard has four steps: Details, Type
(choose **Individual**), Assign To (leave it as **All students** and set a due date a few days
out), and Review.

The assignment is created unpublished. Open it, go to the **Problems** tab, and use **Add
Existing Problem** to add the problem you just built. Then set:

- **Max Points**, say 10.
- **Accepted Submissions**, say 3, so you can watch the attempt count go down.
- **Automatically Graded**, on.

## 5. Publish

Two switches, and both have to be on before a student sees anything:

1. The **Published** switch on the assignment.
2. The **Published** switch in the course's **Course Status** card, on the Settings tab.

Publish the assignment first, then the course. A published course with nothing in it is a
confusing first impression.

## 6. Get a student in

Open the course header and copy either the **registration code** or the **invite link**. Either
one lets somebody join while the self-registration window is open, which you set on the Settings
tab.

You cannot test this with your own account: an administrator cannot self-enrol, and you are
already faculty here anyway. Use a second account. Either create one under
**Administration → User Accounts**, or send the link to a colleague.

Sign in as that student and confirm they can see the course and the assignment.

## 7. Submit something

There are two ways in, and your students will mostly use the second.

**From the browser**, open the assignment, choose the problem, and upload a `.jff` file.

**From JFLAP**, use the [AFCT Submission Center](../student/client.md), which is what the
native client is for: students build the automaton and submit it without leaving the editor.

Submit a **wrong** answer first, on purpose. Watching a wrong answer come back is more
informative than watching a right one.

## 8. Watch it get graded

The submission goes into a queue and the evaluator picks it up. As faculty, open the assignment's
**Submissions** tab and select the student.

You should see the attempt, its result, and the feedback, which for a rejected finite automaton is
usually a counterexample string: a specific input the student's machine gets wrong. That
counterexample is the thing that makes AFCT worth running. The student sees it too.

Now submit the correct answer. It comes back correct, and the grade is written automatically:
full marks for a correct answer, zero for an incorrect one.

Open **Grades** and confirm the score is there.

:::note If nothing is being graded
Check **Administration → System Status → Workers**. If submissions are piling up in "Waiting to be
graded" and nothing is in progress, the evaluator worker is not running. See
[Troubleshooting](../operations/troubleshooting.md).
:::

## 9. Override one student's grade

Still on the Submissions tab, change the student's score by hand and save it.

Two things happen that are worth knowing about. The grade is now **held**, so re-running the
autograder will not overwrite what you decided. And the change is recorded in the activity log
with your name on it, because a changed grade is a record the university has to be able to
account for.

## What you have just seen

| Step | Where it is covered in full |
| --- | --- |
| Courses, roles, publishing | [Faculty guide](../faculty/course.md) |
| Problems and answer files | [Problems](../faculty/problems.md) |
| Assignments, schedules, overrides | [Assignments](../faculty/assignments.md) |
| Reviewing work and grading | [Submissions](../faculty/submissions.md) |
| The student's side | [Student guide](../student/overview.md) |
| Accounts and system settings | [Administrator guide](../guides/admin.md) |

## What to do next

Three things are worth setting up before a real class arrives:

- **Connect your LMS**, so grades go back to Canvas, Moodle, Brightspace or Blackboard instead of
  being copied by hand. See [Connect an LMS](../admin/lms-connection.md).
- **Check your backups**, and in particular put the backup passphrase somewhere that is not the
  server. See [Backups](../operations/backups.md).
- **Set up email**, so people can reset their own passwords. It is on the Email tab of
  [System Settings](../admin/system-settings.md).
