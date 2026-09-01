# Submissions

The **Submissions** page shows every submission across the AFCT installation, including what is still waiting to be graded and what is being graded now. It is useful when an administrator needs to look across courses, or to investigate an evaluator problem that is not limited to one of them.

Problems with the autograder switched off appear here too. They never enter the queue, so their Result reads **Not autograded** rather than a queue state. The **Type** column says whether the work was handed in by a group or an individual.

## Choose the scope

The pickers at the top build on one another:

1. Select one or more courses.
2. Select assignments from those courses.
3. Select problems from those assignments.

Leaving a picker empty means **all of them**, which is why the page opens showing everything. Narrow from the top down: choose courses to unlock the assignment picker, then assignments to unlock the problem picker. Use **Clear Filters** to start over.

The pickers below the one you change keep up with it. Drop a course and the assignments that came with it leave your selection too, so you are never left filtering on something the page can no longer show you. Anything still on offer stays selected, so adding a second course to compare against the first does not cost you the assignment you had already picked.

## Read the table

Each row is one submission, and shows when it arrived, whether it was on time, who submitted it, the course, assignment and problem, the submitted file, the grade, and the grading status. Course, assignment, and problem names link back to the related review pages.

**File** is the student's own file name. Click it to open the submission in the viewer for that problem type, or use the download icon beside it to save the original file. This works the same way as the solution file on a course's problem list.

The viewer opens in a panel over the page, which suits a quick look. For a large machine, **Open in the viewer** puts the same viewer in a browser window of its own, where it has the whole screen and can sit on a second monitor. One window is reused, so opening another machine replaces what is in it rather than adding a second window.

That window has a menu bar of its own:

- **File → Download** offers two things. **Original file** saves the file exactly as it was submitted. **Current view** saves a new `.jff` with the machine laid out as it is on screen, which is useful after **Auto-arranged** has made a crowded drawing readable. The submitted file is never altered by this.
- **File → Export** saves the drawing as an SVG or a PNG.
- **File → Properties** says where the file came from: whether it is a student's submission or the instructor's solution, the course, assignment and problem, the student who submitted it (and the group, on group work), and when it arrived. It says nothing about grades.
- **Edit** copies the drawing: **Copy as PNG** for a document or an email, and **Copy as SVG** for a drawing program or a slide, where it stays sharp at any size. To copy the machine as words, open **View → Text representation** and use the **Copy as text** button there.
- **Machine** chooses how the machine is drawn: **As drawn** places the states where their author put them, and **Auto-arranged** lets the layout engine place them. One of the two is always in effect.
- **Help** opens this documentation page in a new tab.
- **View** holds **Fit to window**, which brings the whole machine back on screen after zooming or panning about, and **Text representation**, which opens the machine written out as states and transitions in a window of its own. It also turns the background **Grid** on and off, shows or hides the **JFLAP Notes** the author wrote on the canvas (on by default, and only drawn in the As drawn layout),.

Clicking a state opens a small panel in the top right of the drawing showing its name, whether it is the initial or a final state, and every transition into and out of it. Clicking a transition does the same for it: which state it leaves and which it enters, whether it is a self-loop, and everything it reads. Where several transitions join the same pair of states they are drawn as one line, so the panel lists all of them. Click the background, or the panel's close button, to dismiss it. The same information for every state at once is under **View → Text representation**, which is also the way to read it without a mouse.

The toolbar keeps one zoom control: a minus, the current percentage, a slider and a plus, grouped together, with **Fit** beside them to bring the whole machine back on screen. Anything the menu offers is taken off the toolbar in this window, so nothing appears twice: the grid, the layout and the export buttons all move into the menus. Zoom stays on the toolbar, because the menu has no zoom. They all act on a drawn machine, so they are unavailable for a grammar or a regular expression, which have nothing to draw.

**Grade** is what that one attempt earned: the problem's full points if the evaluator found it correct, zero if it did not, and a dash while the submission is still pending, processing or failed. A student's several attempts therefore show different grades.

**Recorded grade** is the student's standing grade for the problem, the number the gradebook carries. It is the same on every attempt by that student, so it is off by default; turn it on from **Columns** to spot a grade that was entered by hand and no longer matches the latest attempt.

Two columns carry a coloured badge:

- **Timing** is **On time** or **Late**, measured against the problem's due date for that student.
- **Status** is where the submission has got to: **Pending** (queued), **Processing** (being graded now), **Failed** (the evaluator itself could not finish), **Correct**, or **Incorrect**.

**Failed** and **Incorrect** are different problems. Incorrect is an ordinary result, a student answer that did not match. Failed means the evaluator did not produce a verdict at all, which is worth investigating.

The page opens showing everything in scope. It loads one page of submissions at a time, so searching, filtering and sorting all apply to the whole queue rather than to the rows currently on screen, and the count beside the pager is the total number of matches.

To narrow it:

- **Search** matches across the table, or one field if you pick one in the box beside it.
- **Filters** holds **Timing** on one side and **Status** and **Submission** on the other.

  Status and Submission are two headings over one question, because a submission has exactly
  one of those five values. Picking across them means "either": Failed plus Incorrect finds
  both, it does not find submissions that are somehow both.

  Timing is separate and combines with them, so Timing **Late** plus Submission **Incorrect**
  finds late wrong answers.
- **Columns** turns columns on and off, including **Due** and **Recorded grade**, which are off by default. That choice is remembered in your browser.
- Sort by most column headings, including Status. **Timing**, **Type**, **Grade** and **Recorded grade** cannot be sorted: none of them is a stored value (Timing is a comparison against the due date, Grade is worked out from the result, and Recorded grade is kept with the gradebook), so there is nothing to order the whole queue by. Filter by Timing instead.

There is no CSV export here. The page holds one page of results at a time, so an export would have written whatever was on screen rather than everything matching your filters. To get grades out of AFCT, use the [grade export](../faculty/grades.md#export-grades) on a course instead.

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
