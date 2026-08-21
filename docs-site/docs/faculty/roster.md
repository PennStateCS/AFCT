# Roster

The **Roster** page lists everyone enrolled in the course and their course role. The available roles are Faculty, TA, and Student.

The roster loads a page at a time, so a course with a thousand students opens as quickly as a small one. Searching, filtering and sorting all apply to the whole roster rather than to the people currently on screen, and the number beside the pager is the total who match.

To find someone:

- **Search** matches on name and email, or on one of them if you pick a field in the box beside it.
- **Filters** holds Role and Status as separate lists. Ticking several values in one list widens (any of them), while picking from two different lists narrows (both must be true), so Role **Student** plus Status **Dropped** finds dropped students.
- Sort by any column heading.

## Enroll one person

1. Select **Enroll User**.
2. Start typing a name or email. The search runs as you type and only offers accounts that are not already in the course, so anyone already on the roster (including a dropped student) will not appear. To bring a dropped student back, use **Re-enroll** on their Manage menu instead.
3. Select the person and confirm the enrollment.

When a search matches more people than fit in the list, AFCT says so above it; keep typing to narrow.

Enrollment always adds the person as a **Student**. To give someone a staff role, enroll them first, then change their role with the edit action (see [Manage roles and membership](#manage-roles-and-membership)). Direct enrollment is useful for adding another staff member or helping a student who cannot use self-registration.

## Enroll a list of students

1. Select **Bulk Enroll**.
2. Paste student email addresses. You can separate them with new lines, commas, semicolons, or spaces.
3. Select **Next** and review the matched accounts.
4. Check the **Not found** list before continuing.
5. Select **Enroll** to add the matched accounts as students.

Bulk enrollment only matches people who already have an AFCT account. Email matching is case-insensitive. A person in the **Not found** list must create an account before you can enroll them this way.

## Let students enroll themselves

Each course has a unique registration code that AFCT generates automatically when the course is created. The course header shows this code alongside a ready-to-share invite link; copy either one and share it with students.

Self-registration works only when:

- The course is published
- The current time is inside the self-registration window
- The student uses the correct registration code or invite link

Faculty and TAs can still enroll an existing account directly when self-registration is closed.

## Bring the roster in from your LMS

If the course is connected to an LMS, you can sync the roster instead of enrolling people by
hand: AFCT asks your LMS who is in the course and shows what would change before applying it.
Students the LMS no longer lists are marked dropped rather than deleted, and course staff are
never dropped. See [Grades and rosters from your LMS](lms.md).

## Manage roles and membership

Faculty can use **Manage > Edit Role** on a roster member to change that person's course role. A course must always have at least one Faculty member, so AFCT will not allow the only Faculty member to be demoted.

Faculty can remove a TA or student who has no submissions in the course. Faculty cannot remove another Faculty member. TAs can view the roster and enroll users. Changing someone's role, removing them, and dropping or re-enrolling them are reserved for Faculty and site administrators.

**Remove From Course** deletes the person from the roster entirely. AFCT allows it only when the person has no submitted work, so removal is really for someone added by mistake. When a student has submissions, remove is disabled; **drop** them instead (see below), which keeps their work attached to the course.

Archived courses are read-only, so enrollment and roster changes are unavailable until an administrator restores the course.

## Drop or re-enroll a student

Dropping a student is the way to end their participation in a course while keeping everything they have done. Use it when a student withdraws mid-term, or any time you want to revoke access without erasing their record.

From a student's **Manage** menu on the roster, Faculty (and site administrators) can:

- **Drop From Course**: the student keeps their roster entry, submissions, grades, and group membership, but immediately loses access. The course disappears from their dashboard, sidebar, and calendar, and they can no longer open it or submit, including from the desktop client. The roster marks them with a **Dropped** badge.
- **Re-enroll**: restores a dropped student to full access. Everything they had is exactly as they left it.

A dropped student stays visible to staff. They still appear, labeled **Dropped**, on the roster, in the gradebook (where you can still view and edit their grades), and in the submissions review view. They are left out of the active class everywhere it would be misleading to include them: new assignment audiences, group eligibility for new groups, assignment statistics, and student counts.

Re-enrollment is a staff action. A dropped student cannot rejoin with the registration code; if one tries, they are told to contact their instructor. Re-adding a dropped student through **Bulk Enroll** also re-enrolls them. **Enroll User** will not: its picker leaves out anyone who already has a roster row in the course, dropped or not.

Every drop and re-enroll is recorded in the course [activity log](./activity.md).

## Reset a student's password

When a student is locked out or has forgotten their password, Faculty and TAs can reset it directly from the roster, without waiting for a site administrator. This is a convenience for small deployments, and it works only for **students** enrolled in your course.

1. Find the student on the roster and open their **Manage** menu.
2. Select **Reset Password**.
3. Type a new password and confirm it. The strength rules are shown as you type, and the reset is blocked until the password meets all of them.
4. Leave **Temporary password** turned on (recommended) so the student is required to choose their own password the first time they sign in. Turn it off only if you want the password you typed to stay in place.
5. Select **Reset Password**.

:::tip Prefer a temporary password
With **Temporary password** on, you hand the student a one-time password and they immediately set their own, so you never learn their real password. Share the temporary one over a channel you trust (in person or a direct message), not a public post or class channel.
:::

The reset takes effect immediately and signs the student out of every active session, so they must sign in again with the new password.

:::note Students who open AFCT from your LMS
A student whose account was created by an LMS launch has no AFCT password at all, so there is
nothing to reset: they get in by opening AFCT from your course. **Reset Password** still works
and gives them one, which they need for the AFCT desktop client, since that asks for an email
and a password. They can also set one themselves from their own account page.
:::

**What you can and cannot reset.** This action is limited to students on your roster. You cannot change the password of another Faculty member, a TA, a site administrator, or anyone who is not in your course. Those resets are done by a site administrator on the **User Accounts** page. Every reset is recorded in the course [activity log](./activity.md).

A password reset is not the same as a temporary sign-in lock. If a student is blocked after too many failed sign-in attempts, that lock clears on its own after a short wait, so a reset is only needed when the student has genuinely forgotten their password. If you are locked out of your **own** account, you cannot reset it yourself; ask a site administrator to reset it for you.
