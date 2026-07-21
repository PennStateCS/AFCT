# AFCT Submission Center

**Audience:** students

The AFCT Submission Center is a window built into the JFLAP editor. You design an automaton, grammar, or machine in JFLAP as usual, then use the Submission Center to send it to AFCT for grading without leaving the app. It shows your courses, assignments, and problems, submits your work, and tracks each attempt's result.

The Submission Center only lists work you can access, and it never shows another student's submissions. Deadlines, attempt limits, and access rules are all enforced by the server, so they behave the same as they do in the web app.

## Open the Submission Center

In JFLAP, open the **Assignments** menu and choose **Submission Center**. The window is titled "AFCT Submission".

You can keep it open beside your JFLAP work. If you close it, reopen it the same way; it remembers your session until you sign out.

## Sign in

The first time you open the Submission Center you are asked to sign in:

- **Server** and **Port**: the address of your AFCT server, for example `https://afct.example.edu` and `443`. Your instructor provides these.
- **Email** and **Password**: your AFCT account, the same credentials you use for the web app.
- **Show password**: reveals what you typed so you can check it.
- **Remember Me**: saves the server, port, and email (and password) so you do not retype them next time. Leave it off on a shared computer.
- **Validate SSL Certificate**: keep this **checked** for a normal server. Uncheck it only when connecting to a test or development server that uses a self signed certificate; otherwise the connection is refused.

Select **Login**. Messages appear below the button while it connects. Only active accounts can sign in.

Use **Logout** (top right of the main window) when you are done, especially on a shared machine.

## Find your work

The left **Select** panel holds a tree of your **Courses**, their **Assignments**, and each assignment's **Problems**. Expand a course to see its assignments, and an assignment to see its problems. Each item has an icon:

- **C** (blue) is a course.
- **A** (orange) is an assignment.
- **P** (purple) is a problem, and a green check (✓) marks a problem you have already solved.

An assignment labeled "(no problems)" has nothing to submit yet.

### Filter the list

Two filters at the top of the Select panel narrow the tree, and they apply to every course at once:

- **Assignments: All / Upcoming**: "Upcoming" hides assignments whose due date has already passed.
- **Problems: All / Unsolved**: "Unsolved" hides problems you have already earned full marks on, so you can focus on what is left.

Switching a filter updates the whole tree immediately and keeps your place.

Which courses and assignments appear depends on your role. As a student you see published assignments assigned to you, once they have opened; before an assignment's available date it stays hidden.

## Read the details

Selecting an assignment or a problem fills the panels on the right.

**Selected Assignment** shows the due date (in the course's timezone), whether it is an individual or group assignment, your group name for a group assignment, whether late submissions are accepted and any late cutoff, and the assignment description.

**Selected Problem** shows the problem type (such as Finite Automaton or Pushdown Automaton), any limits like the maximum number of states or a determinism requirement, the points it is worth, your current grade, how many attempts you have used out of the maximum, and the problem description.

## Submit an attempt

1. Select the problem you want to submit.
2. Check the **File to Submit** field in the **Submission** box at the bottom right. By default it is the file you have open in JFLAP. To send a different file, choose **Browse...**; to return to the open file, choose **Use open file**.
3. Select **Submit**.

The file uploads and is placed in the grading queue. A short status message reports progress, and the result appears in Submission History when grading finishes.

A few rules the server enforces:

- Each accepted upload counts as an attempt. A problem may allow unlimited attempts or set a maximum; the Selected Problem panel shows how many you have left. Submitted attempts cannot be edited or deleted, so check your file first.
- After the due date, work is accepted only when late submissions are enabled and any late cutoff has not passed.
- There may be a short cooldown between attempts on the same problem. The status message tells you when you can try again.
- For a group assignment, everyone in your group shares one set of submissions per problem. Any member can submit, and autograding gives the whole group the same grade. Coordinate so you do not submit over each other.

## Track results in Submission History

The **Submission History** panel lists your attempts for the selected problem, newest first, with columns for:

- **Submitted**: the date and time of the attempt, in the course's timezone.
- **File**: the name of the file you uploaded.
- **Status**: where the attempt is. A new attempt is `PENDING` or `PROCESSING` while it waits in the queue, then `COMPLETED` when graded, or `FAILED` if grading could not finish.
- **Result**: whether the attempt was correct once it completes.
- **Feedback**: the grader's message, such as a counterexample string showing why an answer was rejected.

For a group problem, an extra column shows which group member made each submission.

## Refresh

Select **Refresh** (top right) to pull the latest courses, assignments, problems, and results from the server, for example after grading finishes or an instructor publishes new work. Refresh keeps whatever you had expanded and selected. There is a brief cooldown between refreshes.
