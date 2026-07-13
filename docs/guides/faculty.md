# Faculty and TA guide

**Audience:** instructors and teaching assistants.

Your role is set **per course** in the roster, and **faculty and TAs currently
have the same abilities** within a course. Everything in this guide applies to
the courses you are assigned to and to no others; you cannot see or touch a
course you're not on, even to peek. The full permission model lives in
[Roles and permissions](../reference/roles-and-permissions.md).

An administrator creates courses and assigns you to them; from there the course
is yours to run. If you need a new course, a course duplicated, a course
archived or restored, or a course deleted, ask an administrator. Those are all
admin-only, and everything else is yours.

---

## Courses

You can **view and edit** your assigned courses: name, code, semester, credits,
dates, and the course timezone.

You **publish** a course to make it visible to enrolled students. Until you do,
the course is invisible to students by link and by search alike; a student who
somehow gets the URL just sees "not found." This gives you room to build the
course in peace. Enroll people, write assignments, get things right, and flip
the switch when you're ready.

A course is **archived** at the end of a term — by an administrator, not you.
Archiving makes the course **read-only for everyone**, including you and admins:
settings, dates, roster, and grades all freeze. Treat it as closing the books
once final grades are settled. Archiving and restoring are admin-only, so ask an
administrator to archive a finished course (or to restore one you need reopened);
that asymmetry is by design.

---

## Timezone and deadlines

Each course has a timezone, which defaults to the server default. When you
enter a due date, it is read **in the course timezone** and stored as a single
moment in time. That single instant is what everyone is measured against, so a
student in another hemisphere faces exactly the same cutoff as one sitting in
your classroom.

Students see each deadline in both their own local time and the course zone,
which heads off the classic misjudgment where a traveling student does the
timezone arithmetic wrong. And lateness is always decided by the server against
the stored instant. A student who changes their device clock or timezone
changes only what they *see*, never whether their work counts as on time. You
will still get the email claiming otherwise; now you know what to say.

---

## Assignments and problems

You **create an assignment** with a due date, and you can optionally **allow
late submissions** up to a cutoff datetime. Two rules go together here: if you
enable late submissions you must set a cutoff, and the cutoff must be on or
after the due date. There is no such thing as an open-ended late window, which
saves you from the assignment that never actually closes.

You **add problems** to an assignment. For each problem you set:

- **Points** (`maxPoints`).
- **Maximum submissions**, either a cap on attempts or unlimited. A generous
  cap encourages iteration against the autograder; a tight one makes each
  attempt count. Pick deliberately, because attempts are consumed and students
  will notice.
- **Autograding** on or off.

You **upload the answer/solution file** for each problem. **Students never see
or download these files.** The solution is the autograder's key, nothing more;
it stays on the staff side no matter what.

You **publish an assignment** to release it. Unpublished assignments do not
appear to students at all, and on your own calendar they show marked **Draft**
so you can tell your works-in-progress apart from what students can actually
see. It is worth building the whole assignment, submitting to it yourself (see
grading below), and only then publishing.

You can **edit or delete** an assignment, within limits that protect student
work. You cannot unpublish an assignment that already has submissions or
grades, and you cannot change its group/individual mode once submissions exist.
An assignment with submissions or comments cannot be deleted. The common thread
is that once students have acted on something, you can't pull it out from under
them. If you catch a mistake in a live assignment, edit it forward rather than
trying to retract it.

None of these edits are possible while the course is archived.

---

## Roster and enrollment

You manage your own roster. You can **add or remove members** and **assign any
course role**, including making another person faculty or TA, within your own
course. Adding a co-instructor or promoting a strong student to TA does not
require an administrator.

You can **enroll a student directly** at any time, even outside the enrollment
window, which is how you handle the student who adds during week three. For
everyone else, **share an enroll code** and let students enroll themselves;
self-enrollment works while the enrollment window is open and the course is
published. For a whole section at once, **bulk-enroll** from a list.

**Removing a student revokes access but keeps their work.** Re-enroll them and
their submissions and grades reattach. So a mistaken drop, or a student who
drops and re-adds, costs nothing.

A few safety rules keep rosters from going sideways. Students cannot remove
themselves. A member who has submissions cannot be removed. A course must
always keep at least one faculty member, so removing or demoting the last
faculty is refused; a course with no instructor is an orphan nobody can manage.
And faculty cannot remove or demote another faculty member or an admin. Only an
administrator can, which keeps co-instructor disputes out of the roster page.

---

## Grading and feedback

You **see every student's submissions and grades** in your course.

With **autograding** on, submissions are scored automatically as they finish.
The autograder's score is not the last word: you can **override a score by
hand**, including your own scores, and every override is recorded in the audit
log with the before-and-after value. Override freely when the situation calls
for it; the log means you never have to reconstruct what happened from memory
when a student appeals.

You can **re-run** a single submission, or every submission in a course. This
is the tool for the day you discover the solution file was wrong: fix the
problem or its solution file, re-run everything, and every score updates
against the corrected key.

Your own **test-submissions are throwaways**. Submit to a problem yourself to
check that the autograder behaves the way you expect. Because those submissions
are attributed to you and you are not a student on the roster, they never count
as student work in grades or reports. Do this before publishing every
assignment; five minutes of testing saves an inbox full of "the grader is
broken" the night it's due.

You can **export grades** for your courses.

One thing to know before you publish anything: students see their score and
feedback **immediately** once the grader finishes. There is no separate release
step to hold grades back today. If the solution file is wrong, students see
wrong scores in real time, which is one more argument for testing first.

### Comments

Comment on a student's work to leave feedback. Comments are **private per
student**: each student sees only their own thread plus your replies, never a
classmate's. You can be as candid in one student's thread as you would be in
office hours. On a group assignment the thread belongs to the group, and every
member of that group sees it, so write those with the whole group in mind.
Students cannot delete comments; staff and admins can.

---

## Password resets

You can reset the password of a **student enrolled in one of your courses**,
which covers the student who shows up to your office hours locked out. You
cannot act on other staff, on admins, or on anyone who is not a student in a
course you teach; the scope of the power matches the scope of your
responsibility. (An administrator can reset anyone's password.)

---

## Groups (group assignments)

A group assignment has **one shared submission per group**. Any member can
submit, and every member of that group sees the submission, its files, its
grade, and its feedback. Visibility never crosses into another group; group A
cannot inspect group B's work, period. You (and admins) see all groups, and you
can create groups and assign members while the course is active.
