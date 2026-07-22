# Roster

The **Roster** page lists everyone enrolled in the course and their course role. The available roles are Faculty, TA, and Student.

## Enroll one person

1. Select **Enroll User**.
2. Search for an existing AFCT account that is not already in the course.
3. Select the person and confirm the enrollment.

Enrollment always adds the person as a **Student**. To give someone a staff role, enroll them first, then change their role with the edit action (see [Manage roles and membership](#manage-roles-and-membership)). Direct enrollment is useful for adding another staff member or helping a student who cannot use self-registration.

## Enroll a list of students

1. Select **Bulk Enroll**.
2. Paste student email addresses. You can separate them with new lines, commas, semicolons, or spaces.
3. Select **Next** and review the matched accounts.
4. Check the **Not found** list before continuing.
5. Select **Enroll** to add the matched accounts as students.

Bulk enrollment only matches people who already have an AFCT account. Email matching is case-insensitive. A person in the **Not found** list must create an account before you can enroll them this way.

## Let students enroll themselves

The course header contains a registration code and an invite link. You can copy either one and share it with students.

Self-registration works only when:

- The course is published
- The current time is inside the self-registration window
- The student uses the correct registration code or invite link

Faculty and TAs can still enroll an existing account directly when self-registration is closed.

## Manage roles and membership

Faculty can use the edit action beside a roster member to change that person's course role. A course must always have at least one Faculty member, so AFCT will not allow the only Faculty member to be demoted.

Faculty can remove a TA or student who has no submissions in the course. Faculty cannot remove another Faculty member. TAs can view the roster and enroll users, but roster role changes and removals are reserved for Faculty and site administrators.

AFCT blocks removal when the person has submitted work. This keeps every submission attached to a current course member. Contact a site administrator if you need help resolving a roster entry that the interface will not let you change.

Archived courses are read-only, so enrollment and roster changes are unavailable until an administrator restores the course.

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

**What you can and cannot reset.** This action is limited to students on your roster. You cannot change the password of another Faculty member, a TA, a site administrator, or anyone who is not in your course. Those resets are done by a site administrator on the **User Accounts** page. Every reset is recorded in the course [activity log](./activity.md).

A password reset is not the same as a temporary sign-in lock. If a student is blocked after too many failed sign-in attempts, that lock clears on its own after a short wait, so a reset is only needed when the student has genuinely forgotten their password. If you are locked out of your **own** account, you cannot reset it yourself; ask a site administrator to reset it for you.
