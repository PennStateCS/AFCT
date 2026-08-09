# Grades

The **Grades** page gives Faculty and TAs a course-wide view of student scores. Each row is a student, and each assignment has its own column.

## Read the gradebook

An assignment cell shows the student's earned points and the assignment's available points. A dash means the assignment does not have a recorded grade for that student.

The **Average** column calculates a percentage from the assignments that have recorded grades. Ungraded assignments are not included in that total, so treat it as a progress summary rather than a final course grade until grading is complete. Only assignments a student is actually assigned count toward it, so a student who is not assigned everything is not measured against the full course total.

The gradebook loads a page of students at a time, so a course with a thousand students opens as quickly as a small one. Searching and sorting apply to the whole class rather than to the students currently on screen, and the number beside the pager is the total who match:

- **Search** matches a student's name or email.
- Sort by any column heading, including an individual assignment and **Average**. Sorting by Average is the quickest way to find who is falling behind, and it orders the whole class, not the page you are looking at.

Select **Refresh** after grading in another tab or when you want to load the latest scores. AFCT also refreshes stale grade data when you return to the page.

## Edit a grade breakdown

1. Select a student's grade for an assignment.
2. Review the list of problems, maximum points, and current scores.
3. Enter or clear the score for each problem that needs an update.
4. Select **Save**.

Each score must be between zero and that problem's maximum points. Saving the breakdown updates the assignment total shown in the gradebook.

Grades you save here are held, so re-running the autograder will not change them.

### Where each grade came from

Two columns answer two different questions, and it is worth keeping them apart.

**Problem Setting** is how the problem is set up. It reads the same whether or not the student has been graded yet.

| Badge | Meaning |
| --- | --- |
| **Automatic** | The autograder grades this problem. |
| **Manual** | This problem is graded by hand. Re-running the evaluator gives the student feedback but never sets a score. |

**Grade Source** is who produced this particular score.

| Badge | Meaning |
| --- | --- |
| **Autograder** | The autograder produced this score. |
| **Manual** | Someone entered this score by hand. |
| **Not graded** | No score has been recorded yet. |

An **Automatic** problem with a **Manual** grade source is someone overriding the autograder, which is why that combination is highlighted.

A padlock beside the score's origin means the autograder cannot change it. It appears only on problems the autograder grades, because nothing overwrites a score on a hand-graded problem. Releasing a held score hands it back to the autograder, and is done from the assignment's [Submissions](submissions.md) tab.

Releasing a score does not change who is credited with it. A score you entered still reads as **Manual**; it simply loses the padlock.

You can also grade from the assignment's [Submissions](submissions.md) tab. That view is better when you need to inspect files, autograder feedback, or discussion before entering a score.

## Export grades

The grade export currently appears only for site administrators. It can produce CSV files for Canvas, Blackboard, Brightspace, Moodle, or a generic gradebook. Faculty and TAs who need an LMS export should contact their site administrator.

Export formats match students using an LMS identifier, often an email address. Before importing a CSV, review the instructions shown for the selected LMS and confirm that its usernames or login IDs match the values stored in AFCT.
