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

To check whether they arrived, look at the **LMS Sync** section beside the grade you are giving. It reports on the student whose work is open: whether their grade has been sent, is waiting, or could not be sent, and why. **Send this grade now** sends that student's grade and nobody else's.

When other students on the same assignment are waiting or have failed, the section says so and offers **Send all outstanding grades**, which is the button to use after your LMS has been down.

A few things worth knowing:

- **A grade that fails to send is retried**, several times with a growing gap. Both buttons also retry a grade that had given up, so they are what to use once the cause is fixed.
- **Regrading replaces a queued grade** rather than sending two. The LMS sees the final figure.
- **A student who has never opened AFCT from the LMS still gets their grade**, as long as their LMS identity is known. Running a roster sync is what connects the rest.
- **Grades are clamped to the assignment's points.** If you change what an assignment is worth after linking it, AFCT updates the LMS column to match.

If **Send grades automatically** is off, nothing goes to your LMS for that assignment until you send it yourself.

## Bring your roster in line

A roster sync asks your LMS who is in the course and shows you what would change before anything happens.

1. Select **Sync roster** on the course **Roster** tab. (It is also on the **Settings** tab, in the **Course status** card beside the settings form.) The button only appears once your course is connected to an LMS.
2. Read the preview. It lists who **will be added**, who **will be marked dropped**, and who is **kept as they are**.
3. Select **Apply these changes**.

Two rules protect you here:

- **Nobody is deleted.** A student your LMS no longer lists is marked **dropped**, so their submissions and grades survive and re-enrolling brings them back.
- **Course staff are left alone.** A faculty member or TA missing from the LMS roster is never dropped, because people are given access in AFCT for reasons your LMS does not know about.

Students who have no AFCT account get one, and students who already have an account keep it rather than getting a second.

Syncing is always something you ask for. AFCT does not quietly change your roster in the background.

## Link straight to one assignment

Some LMSs let you pick the AFCT assignment while adding the link, so students land on that assignment rather than on the AFCT course. If yours supports it, choosing AFCT while adding an assignment or module item offers two ways to go:

- **Use an assignment that already exists.** Assignments already opened by a link in this LMS course are left out of the list, and the screen says how many, so a missing one is explained rather than mysterious.
- **Create a new assignment.** Give it a title and a due date and AFCT makes it, publishes it and links it in one step. Problems, points and everything else are added in AFCT afterwards.

**An assignment can only be linked once per LMS course.** Two links to the same work would give your gradebook two columns for it, and the grades would disagree about which is real.

The course has to be linked first, and you have to be the one who runs it. These links need to open in a new tab as well, so check that setting on the assignment or module item once it has been added. You pick one assignment at a time, even in an LMS that would let you select several at once.

Not every spot in an LMS accepts this kind of link. If you add AFCT somewhere that only takes a page or a file, AFCT tells you so instead of quietly doing nothing, and the message says what to do about it. The fix is normally to add AFCT somewhere that takes an external tool link, or to ask your administrator to look at how the AFCT placement is set up.

## Disconnecting

To stop using your LMS with a course, open the course **Settings** tab, find the **Course status** card, and select **Disconnect**. Grades stop being sent and roster syncing is no longer offered. Nothing already in AFCT is removed, and nothing already in your LMS gradebook is taken back.
