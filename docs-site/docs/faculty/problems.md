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

Create Problem is a short guided wizard with four steps: Details, Type, Answer File, and Review.

1. Open the course and select **Problems**.
2. Select **Create Problem**.
3. On **Details**, enter a clear title and an optional description.
4. On **Type**, choose the problem type. For a finite automaton or push-down automaton, choose a state limit or leave it unlimited; for a finite automaton, turn on **Deterministic** when the student's answer must be deterministic.
5. On **Answer File**, upload the answer file.
6. On **Review**, confirm your choices and select **Create Problem**.

A problem in the bank is only the definition. Points, the accepted-submission limit, and automatic grading are set per assignment, not on the problem itself (see below).

You can also create a problem from inside an assignment. In that case, AFCT adds the new problem to the course bank and to the open assignment.

## Review and edit a problem

The problem table shows the title, type, answer file, state limit, deterministic requirement, and creation date. A **Used** label means the problem belongs to at least one assignment.

Open **Manage** to:

- **View Answer** using the viewer for that problem type
- **Edit Problem** details and replace the answer file
- **Delete Problem** when the problem is not used by an assignment

Editing a problem from the course bank uses the same wizard and changes the definition only: title, description, type, state limit, deterministic requirement, and answer file. If you change the problem type, you must upload a new answer file of the matching type.

Points, the accepted-submission limit, and automatic grading belong to each assignment, not to the bank problem. Set them when you add the problem to an assignment, or change them later from the assignment's **Problems** tab (**Manage** the problem and open its settings). The same problem can carry different values in different assignments.

## Before publishing

Open each answer with **View Answer** and check that it renders as expected. Then open the assignment and confirm its point values and submission limits. This quick check catches mismatched files and assignment-specific settings before students start submitting.
