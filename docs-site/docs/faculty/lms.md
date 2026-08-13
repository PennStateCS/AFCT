# Grades and rosters from your LMS

If your institution has connected AFCT to Canvas, D2L Brightspace, or Blackboard, you can link your AFCT course to the matching LMS course. Once linked:

- students open AFCT from your LMS without signing in again,
- grades go back to your LMS gradebook,
- your AFCT roster can be brought in line with your LMS roster.

Your LMS stays the system of record for the final grade. AFCT sends grades to it; it does not replace it.

If none of this appears, your institution has not registered an LMS yet. Ask your AFCT administrator, who has the steps in [Connecting an LMS](../admin/lms-connection.md).

## Link your course

1. In your LMS course, add a link to AFCT. What this is called varies: an external tool, an app, or an LTI link.
2. **Set the link to open in a new tab.** Canvas calls this **Load In New Tab**; other systems word it as opening in a new window. AFCT will not open inside a panel on the LMS page, and a link left on the default setting shows students an empty box instead.
3. Open that link.
4. The first time, AFCT asks which of your AFCT courses this is. Pick it and confirm.

You only do this once per course. Everyone who opens the link afterwards lands in the right AFCT course.

Only courses **you** run are offered, so you cannot attach a colleague's course to your LMS course by mistake.

## Send grades to your LMS

Grade sync is set per assignment, so you can autograde practice work in AFCT without it appearing in your gradebook.

To turn it on, open the assignment, go to the **Settings** tab, and switch on **Send grades automatically**. Grades then go to your LMS as you award and change them, including grades from the autograder.

To check whether they arrived, look at **Grades in your LMS** on the assignment's **Submissions** tab, and in the **LMS Sync** section beside the grade you are giving. Either one tells you what is waiting, what has been sent, and what failed, and both have a **Send grades now** button that pushes everything outstanding for that assignment immediately.

A few things worth knowing:

- **A grade that fails to send is retried**, several times with a growing gap. **Send grades now** also retries anything that failed, so it is the right button when your LMS was down.
- **Regrading replaces a queued grade** rather than sending two. The LMS sees the final figure.
- **A student who has never opened AFCT from the LMS still gets their grade**, as long as their LMS identity is known. Running a roster sync is what connects the rest.
- **Grades are clamped to the assignment's points.** If you change what an assignment is worth after linking it, AFCT updates the LMS column to match.

If **Send grades automatically** is off, nothing goes to your LMS for that assignment until you select **Send grades now**.

## Bring your roster in line

A roster sync asks your LMS who is in the course and shows you what would change before anything happens.

1. Go to the course **Settings** tab and find the **Course status** card beside the settings form.
2. Select **Sync roster from your LMS**.
3. Read the preview. It lists who **will be added**, who **will be marked dropped**, and who is **kept as they are**.
4. Select **Apply these changes**.

Two rules protect you here:

- **Nobody is deleted.** A student your LMS no longer lists is marked **dropped**, so their submissions and grades survive and re-enrolling brings them back.
- **Course staff are left alone.** A faculty member or TA missing from the LMS roster is never dropped, because people are given access in AFCT for reasons your LMS does not know about.

Students who have no AFCT account get one, and students who already have an account keep it rather than getting a second.

Syncing is always something you ask for. AFCT does not quietly change your roster in the background.

## Link straight to one assignment

Some LMSs let you pick the AFCT assignment while adding the link, so students land on that assignment rather than on the AFCT course. If yours supports it, choosing AFCT while adding an assignment or module item shows a list of the assignments in your linked AFCT course, and the one you pick becomes the link.

The course has to be linked first, and you have to be the one who runs it. These links need to open in a new tab as well, so check that setting on the assignment or module item once it has been added.

## Disconnecting

To stop using your LMS with a course, open the course **Settings** tab, find the **Course status** card, and select **Disconnect**. Grades stop being sent and roster syncing is no longer offered. Nothing already in AFCT is removed, and nothing already in your LMS gradebook is taken back.
