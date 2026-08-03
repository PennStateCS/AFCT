# Autograder Queue

The **Autograder Queue** page shows submissions across the AFCT installation, including what is still waiting to be graded and what is being graded now. It is useful when an administrator needs to investigate an evaluator problem that is not limited to one course.

## Choose the scope

The pickers at the top build on one another:

1. Select one or more courses.
2. Select assignments from those courses.
3. Select problems from those assignments.

Use **Select All** to select the available courses, assignments, and problems. Use **Clear Filters** to start over.

## Read the table

Each row is one submission, and shows when it arrived, whether it was on time, who submitted it, the course, assignment and problem, the grade, and the grading status. Course, assignment, and problem names link back to the related review pages.

Two columns carry a coloured badge:

- **Timing** is **On time** or **Late**, measured against the problem's due date for that student.
- **Status** is where the submission has got to: **Pending** (queued), **Processing** (being graded now), **Failed** (the evaluator itself could not finish), **Correct**, or **Incorrect**.

**Failed** and **Incorrect** are different problems. Incorrect is an ordinary result, a student answer that did not match. Failed means the evaluator did not produce a verdict at all, which is worth investigating.

The page opens showing everything in scope. To narrow it:

- **Search** matches across the table, or one column if you pick one in the box beside it.
- **Filters** holds Timing, Status and Submission as separate lists. Ticking several values in one list widens (any of them), while picking from two different lists narrows (both must be true), so Timing **Late** plus Submission **Incorrect** finds late wrong answers.
- **Columns** turns columns on and off, including **Due**, which is off by default. That choice is remembered in your browser.
- Sort by any column heading, including Timing and Status.
- **Export** downloads the visible rows as CSV.

## Inspect a submission

Each row has a **Manage** menu:

- **View submission** opens the submitted file in the viewer for that problem type
- **Open in submission review** jumps to the assignment's own review screen, next to the grade box and the discussion
- **View feedback** shows the evaluator's feedback
- **Download** saves the original file
- **Rerun** sends the submission back to the evaluator

A pending or processing submission cannot be rerun yet, and feedback is not available until grading finishes.

Rerunning is per submission. Start with the narrowest useful filter when you are working through a batch: a broad rerun places avoidable work on the evaluator and can make it harder to isolate the original failure. After rerunning, check the updated status and feedback before changing grades manually.

For normal course grading and discussion, use the assignment's [Submissions](../faculty/submissions.md) page instead.
