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

Faculty and TAs can reset the password of a **student** on their roster, which helps in small deployments where a student is locked out and no site administrator is immediately available.

1. Open the member's **Manage** menu and select **Reset Password**.
2. Enter a new password that meets the strength rules, and confirm it.
3. Optionally turn on **Temporary password** to require the student to choose a new one at their next sign-in.

The reset takes effect immediately and signs the student out of any active sessions. This action is limited to students: it is not available for Faculty or TA members, and it cannot change a site administrator's password. Resetting passwords for staff, or for anyone outside the course, is done by a site administrator on the **User Accounts** page. Every reset is recorded in the course activity log.
