# Faculty and TA guide

**Audience:** instructors and teaching assistants.

Your role is set **per course** in the roster, and **faculty and TAs currently
have the same abilities** within a course. Everything here applies to the courses
you are assigned to and to no others — you cannot see or touch a course you're not
on. For the full permission model, see [Roles and permissions](../role-inheritance.md).

An administrator creates courses and assigns you to them; you run the course from
there. If you need a new course, a course duplicated, a course un-archived, or a
course deleted, ask an administrator — those are admin-only.

---

## Courses

- **View and edit** your assigned courses — name, code, semester, credits, dates,
  and the course timezone.
- **Publish** a course to make it visible to enrolled students. An unpublished
  course is invisible to students by link and by search alike; they get a
  "not found" until you publish.
- **Archive** a course at the end of a term. Archiving makes it **read-only for
  everyone**, including you and admins. Its settings, dates, roster, and grades are
  frozen. Ask an administrator if you need it reopened.

---

## Timezone and deadlines

Each course has a timezone, which defaults to the server default. Due dates you
enter are read **in the course timezone** and stored as a single moment in time,
so every student sees the same deadline no matter where they are. Students see
each deadline in both their own local time and the course zone, so no one
misjudges the cutoff. Lateness is always decided by the server against that stored
instant — a student changing their device clock or timezone changes only what they
*see*, never whether their work is on time.

---

## Assignments and problems

- **Create an assignment** with a due date, and optionally **allow late
  submissions** up to a cutoff datetime. If you enable late submissions you must
  set a cutoff, and the cutoff must be on or after the due date.
- **Add problems** to an assignment. For each problem you set:
  - **Points** (`maxPoints`).
  - **Maximum submissions** — a cap on attempts, or unlimited.
  - **Autograding** on or off.
- **Upload the answer/solution file** for a problem. **Students never see or
  download these files** — they are the autograder's key.
- **Publish an assignment** to release it. Unpublished assignments do not appear to
  students; on your own calendar they show marked **Draft** so you can tell them
  apart from released work.
- **Edit or delete** an assignment. You cannot unpublish an assignment that already
  has submissions or grades, or change its group/individual mode once submissions
  exist. An assignment with submissions or comments cannot be deleted.

None of these edits are possible while the course is archived.

---

## Roster and enrollment

- **Add or remove members**, and **assign any course role** — including making
  another person faculty or TA — within your own course.
- **Enroll a student directly** at any time (you may bypass the enrollment window),
  or **share an enroll code** for self-enrollment while the enrollment window is
  open and the course is published.
- **Bulk-enroll** students from a list.
- **Removing a student** revokes access but **keeps their work** — re-enroll them
  and their submissions and grades reattach.

A few safety rules: students cannot remove themselves; a member who has
submissions cannot be removed; and a course must always keep at least one faculty
member, so removing or demoting the last faculty is refused. Faculty cannot remove
or demote another faculty member or an admin — only an administrator can.

---

## Grading and feedback

- **See every student's submissions and grades** in your course.
- With **autograding** on, submissions are scored automatically as they finish.
  You can **override a score by hand** — including your own — and every override is
  recorded in the audit log with the before-and-after value.
- **Re-run** a single submission, or every submission in a course, after you change
  a problem or its solution file.
- Your own **test-submissions are throwaways** — you can submit to a problem to
  check the autograder, and because those submissions are attributed to you (not a
  student on the roster) they never count as student work in grades or reports.
- **Export grades** for your courses.

Students see their score and feedback **immediately** once the grader finishes;
there is no separate release step to hold grades back today.

### Comments

Comment on a student's work to leave feedback. Comments are **private per student**:
each student sees only their own thread plus your replies — never a classmate's.
On a group assignment the thread belongs to the group, and every member of that
group sees it. Students cannot delete comments; staff and admins can.

---

## Password resets

You can reset the password of a **student enrolled in one of your courses**. You
cannot act on other staff, on admins, or on anyone who is not a student in a course
you teach. (An administrator can reset anyone's password.)

---

## Groups (group assignments)

A group assignment has **one shared submission per group**. Any member can submit,
and every member of that group sees the submission, its files, its grade, and its
feedback. Visibility never crosses into another group. You (and admins) see all
groups and can create groups and assign members while the course is active.
