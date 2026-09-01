# Problems

The **Problems** page is the reusable problem bank for a course. Create a problem once, then add it to one or more assignments.

## Supported problem types

AFCT supports these problem types in the course interface:

- Finite Automaton
- Push-Down Automaton
- Context-Free Grammar
- Regular Expression

The answer file is the solution AFCT uses to display the expected model and, when enabled, grade student submissions. It is also what lets the [Similarity](similarity.md) tab say when matching work is simply the answer you posted. Accepted file extensions include `.txt`, `.fa`, `.pda`, `.cfg`, `.re`, and `.jff`. The file must contain valid JFLAP XML and its type must match the problem type.

## Create a problem

Create Problem is a short guided wizard with four steps: Details, Type, Answer File, and Review.

1. Open the course and select **Problems**.
2. Select **Create Problem**.
3. On **Details**, enter a clear title and an optional description. The description accepts formatting, equations and links, see [Formatted descriptions](descriptions.md).
4. On **Type**, choose the problem type. For a finite automaton or push-down automaton, choose a state limit or leave it unlimited; for a finite automaton, turn on **Deterministic** when the student's answer must be deterministic.
5. On **Answer File**, upload the answer file.
6. On **Review**, confirm your choices and select **Create Problem**.

A problem in the bank is only the definition. Points, the accepted-submission limit, and automatic grading are set per assignment, not on the problem itself (see below).

You can also create a problem from inside an assignment. In that case, AFCT adds the new problem to the problem bank and to the open assignment.

To try an answer file against a sample submission before you build a problem around it, see the [Evaluator Sandbox](evaluator-sandbox.md).

## Review and edit a problem

The problem table shows the title, type, answer file, state limit, deterministic requirement, and creation date. A **Used** label means the problem belongs to at least one assignment.

Open **Manage** to:

- **View Answer** using the viewer for that problem type. The viewer has an **Open in a new window** button, which shows the same thing in a window of its own for a machine too large to read comfortably in a panel.
- **Edit Problem** details and replace the answer file
- **Duplicate Problem** to create a copy in the same bank
- **Delete Problem** when the problem is not used by an assignment

Editing a problem from the problem bank uses the same wizard and changes the definition only: title, description, type, state limit, deterministic requirement, and answer file. If you change the problem type, you must upload a new answer file of the matching type.

Points, the accepted-submission limit, and automatic grading belong to each assignment, not to the bank problem. Set them when you add the problem to an assignment, or change them later from the assignment's **Problems** tab (**Manage** the problem and open its settings). The same problem can carry different values in different assignments.

## Duplicate a problem

**Duplicate Problem** creates a fresh copy of an existing problem in the same bank. Edit the copy's title and description in the dialog; the type, state limit, deterministic requirement, and the answer file are copied from the original. The copy gets its own answer file, so replacing it later never touches the original. Once the copy is created you can edit any of the remaining details from **Edit Problem**.

## Import a problem from another course

**Import Problem** (next to Create Problem) copies a problem out of a different course you teach or assist into this one's bank. It is a short wizard:

1. **Source** - pick a course, then a problem. The course list shows every course where you are faculty or a TA (administrators see all courses), including archived courses.
2. **Details** - the title and description start as the source problem's; edit them or leave them as is.
3. **Review** - a summary before you import.

The type, state limit, deterministic requirement, and the answer file are copied from the source into a new problem here, with its own answer file, so the original in the other course is never affected. Edit the remaining details from **Edit Problem** afterward. To copy a problem *within* the same course, use Duplicate instead.

## Before publishing

Open each answer with **View Answer** and check that it renders as expected. Then open the assignment and confirm its point values and submission limits. This quick check catches mismatched files and assignment-specific settings before students start submitting.
