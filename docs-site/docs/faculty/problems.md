# Problems

The **Problems** page is the reusable problem bank for a course. Create a problem once, then add it to one or more assignments.

## Supported problem types

AFCT supports these problem types in the course interface:

- Finite Automaton
- Push-Down Automaton
- Context-Free Grammar
- Regular Expression

The answer file is the solution AFCT uses to display the expected model and, when enabled, grade student submissions. Accepted file extensions include `.txt`, `.fa`, `.pda`, `.cfg`, `.re`, and `.jff`. The file must contain valid JFLAP XML and its type must match the problem type.

## Create a problem

1. Open the course and select **Problems**.
2. Select **Create Problem**.
3. Enter a clear title and an optional description.
4. Choose the problem type.
5. For a finite automaton or push-down automaton, choose a state limit or leave it unlimited.
6. For a finite automaton, turn on **Deterministic** when the student's answer must be deterministic.
7. Choose whether the problem is **Automatically Graded**.
8. Upload the answer file and select **Create Problem**.

You can also create a problem from inside an assignment. In that case, AFCT adds the new problem to the course bank and to the open assignment.

## Review and edit a problem

The problem table shows the title, type, answer file, state limit, deterministic requirement, and creation date. A **Used** label means the problem belongs to at least one assignment.

Open **Manage** to:

- **View Answer** using the viewer for that problem type
- **Edit Problem** details and replace the answer file
- **Delete Problem** when the problem is not used by an assignment

When editing a problem from the course bank, you can also change its default maximum points, maximum submissions, and automatic grading setting. If you change the problem type, you must upload a new answer file of the matching type.

When editing a problem from an assignment, the points, submission limit, and automatic grading setting apply only to that assignment.

## Before publishing

Open each answer with **View Answer** and check that it renders as expected. Then open the assignment and confirm its point values and submission limits. This quick check catches mismatched files and assignment-specific settings before students start submitting.
