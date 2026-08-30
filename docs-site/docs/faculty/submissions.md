# Submissions

The **Submissions** tab is inside an assignment. It brings a student's submitted files, autograder results, discussion, and grades into one review workspace.

## Open the review workspace

1. Open the course and select **Assignments**.
2. Select the assignment title.
3. Select **Submissions**.
4. Choose a student from the student menu, or use **Previous** and **Next**.
5. Choose a problem from the problem list.

The student menu uses a green marker when every problem has a grade and a red marker when one or more grades are missing. The top of the workspace also shows the due date, late-work policy, selected student's total, and position in the roster.

For group assignments, the group shares one submission set per problem, so the work you review for a student is their group's work. Autograding grades the whole group, but you can override an individual member's grade here without changing the rest of the group.

## Review submitted work

Submissions are listed newest first, one row per attempt: the attempt number, when it was submitted, who submitted it (on group work), whether it was **On time** or **Late**, the result, the feedback, and the file.

Use the status filters to focus on the results you need. For each submission, you can:

- View autograder feedback when feedback is available
- Open the submitted file in AFCT's viewer, which draws the machine and any notes the student wrote on the JFLAP canvas
- Download the original submitted file
- Rerun the submission through the autograder

To grade an attempt again, open its **Attempt actions** menu on the row and choose **Rerun the autograder**. A submission that is pending or processing cannot be rerun yet.

**Rerunning an older attempt does not change the grade.** Only a student's (or group's) most recent submission for a problem holds the standing grade, so rerunning an earlier one updates that attempt's own result and leaves the gradebook alone. Rerun the latest attempt if you want the grade to move.

To rerun a batch, an administrator can use **Rerun Failed Submissions** on the site-wide [Submissions page](../admin/submissions.md).

To see whether a submission shares an origin with another student's, use the assignment's [Similarity](similarity.md) tab.

## Enter a grade

1. Review the submission and any autograder feedback.
2. Enter a score from zero through the problem's maximum points.
3. Select **Save**.
4. Move to the next problem or student.

Enter a score only after checking that you have the right student and problem. You can also edit several problem scores at once from the [Grades](grades.md) page by opening a student's assignment breakdown.

### Grades the autograder cannot change

On a problem the autograder grades, a line under the grade field reports where the current score came from and whether the autograder can still change it. Any score you enter is held automatically, so a re-run leaves it alone. You do not need to lock anything yourself.

Two buttons appear there, depending on the state:

- **Release to autograder** hands a held score back. The score does not change now, but the next time that submission is re-run the autograder may replace it, without anyone entering a new score. AFCT asks you to confirm before doing this.
- **Lock this grade** protects a score the autograder produced, so a later re-run cannot change it.

Releasing a score does not change who is credited with it. If you entered the score yourself, it still reads as a manual override; the line simply warns that the autograder can now replace it.

Nothing appears on a problem that is not automatically graded. Re-running the evaluator there produces feedback and never writes a grade, so there is nothing to protect against. Whether the student reads that feedback depends on **Show Feedback to Students** for the problem; you and your TAs see it either way.

## Check a grade reached your LMS

When the course is connected to an LMS, the **LMS Sync** section beside the grade reports on
**the student you are looking at**: whether their grade is waiting, sent, or failed.
**Send this grade now** pushes that one grade immediately. If other students on the assignment
are also waiting or have failed, a second button, **Send all outstanding grades**, appears
beside it. See [Grades and rosters from your LMS](lms.md).

## Grant extra submissions

Each problem has a shared submission limit set in the assignment's problem settings.
When one student needs another try (for example, they submitted the wrong file), grant
them extra attempts instead of raising the shared limit for everyone.

1. Select the student and the problem.
2. Open the **Problem actions** menu at the top of the Submissions panel and choose
   **Grant extra submissions**. The item is hidden when the problem already allows
   unlimited attempts.
3. On a group assignment, choose whether the whole group or just this student receives
   them. Attempts are counted group-wide, so granting the group lets any member use
   them; granting one student lets only that student submit past the shared limit.
4. Enter how many extra attempts to add and, optionally, why.
5. Select **Grant**.

Grants add together: granting one more twice gives two extra attempts. The student sees
their own higher limit in their assignment view, and the workspace header here shows the
limit that applies to the selected student. A problem with unlimited submissions cannot
be granted more.

## Grade a group assignment

On a group assignment the grade box adds the same **Grade** choice the discussion has, and it
also defaults to the group. Entering a grade once records it for every member, so a shared
submission does not have to be graded person by person.

If some members already have a different grade, AFCT stops and names them with their current
grades before doing anything, so a deliberate adjustment is never overwritten by accident.
Confirm to apply, or cancel to leave everything as it was.

To give one member something different, switch to **Only \<student\>** and grade them on their
own. Their grade then shows **Adjusted from \<value\>**, so it is clear the difference was
intended rather than a mistake.

## Use the discussion

The **Discussion** panel belongs to the selected student and problem. Add a comment when you need to explain a score, ask for clarification, or leave feedback that does not fit the autograder result.

On a **group assignment** the panel adds a **Send to** control, because the submission belongs to the whole group. It defaults to the group, so feedback on shared work reaches every member as a single comment rather than a copy each. Switch it to **Only \<student\>** for something meant for one person, such as a note about their individual contribution.

Every comment shows who can read it, either **Visible to \<group\>** or **Only \<student\>**, so you can tell at a glance what a member of the group has already seen. Individual assignments show neither control nor badge: those comments are always between you and that student.

You can delete a comment you wrote yourself. The Delete button appears only on your own comments. Comments count as assignment activity and prevent the assignment from being deleted.

Archived courses remain available for review, but grades, comments, and other course changes are read-only.
