# Administrator guide

**Audience:** AFCT system administrators

Administrator access is controlled by the global `isAdmin` flag. It is separate from course roles. An administrator can also be enrolled as Faculty or a TA in a course, and both sets of permissions apply.

Administrators manage the platform, accounts, course lifecycle, server settings, and operational health. Faculty and TAs manage the day-to-day work inside their courses.

See [Roles and permissions](../reference/roles-and-permissions.md) for the complete authorization model.

## Accounts

Use the **Users** page to manage accounts.

### Create an account

A new account requires a name, email address, and password. The account has no course access until it is added to a roster or the user joins a course with an enrollment code.

### Disable or enable an account

Disabling an account signs the user out and blocks future sign-ins. The account, submissions, and audit history remain in the system.

Use disable instead of delete when the account has real activity or may need to be restored later.

### Delete an account

Delete accounts that were created by mistake or used only for testing. For accounts with meaningful history, disabling is safer because it preserves attribution.

### Grant administrator access

You can add or remove the `isAdmin` flag. You cannot remove your own administrator flag.

### Unlock an account

Repeated failed sign-in attempts can temporarily lock an account. Use **Unlock** when the user should not have to wait for the lockout period to end.

### Reset a password

Administrators can reset any user's password. Mark the password as temporary so the user must choose a new one at the next sign-in.

AFCT does not store or display the plaintext password after the reset.

### Email addresses cannot be changed

The email address is the permanent account identifier. It cannot be changed by the user, course staff, or an administrator.

When an account has the wrong email address, create a new account with the correct address.

### Bulk account creation

Use bulk import to create accounts from a roster file. Each row is validated independently. Valid rows are created, and invalid rows are reported with a reason.

Common errors include:

- Missing required fields
- Invalid email addresses
- Passwords that do not meet the policy
- Email addresses already in use

Fix the failed rows and import them again. Rows that succeeded do not need to be repeated.

For shared or initial passwords, require a temporary password change.

## Signup and access control

Signup settings are under **System Settings**.

### Allow user signup

Turn this off when all accounts will be created by administrators or roster imports.

### Allowed signup email domains

Enter the domains that may create accounts through public signup. Leave the list empty to allow any domain.

Domain restrictions apply even when public signup is enabled.

### Signup protection

AFCT protects signup with password rules, rate limiting, captcha challenges, and temporary blocks. hCaptcha keys are configured under the security settings.

## Course lifecycle

Administrators own the actions that create, copy, freeze, restore, or delete a course. Faculty and TAs handle normal course operations after the course is created.

### Create a course

Create the course and assign its initial Faculty member. New courses begin unpublished.

### Duplicate a course

Duplication copies course settings, assignments, problems, answer files, points, submission limits, and autograding settings.

The roster is not copied. The new course starts unpublished with an empty roster so students from the earlier course are not carried into the new term.

### Archive a course

Archiving makes the course read-only for everyone, including administrators. Faculty and administrators can still view it, but students cannot access it.

Archiving and restoring are administrator-only actions.

### Restore an archived course

Restoring removes the archive freeze and returns the course to normal operation.

### Delete a course

Deletion depends on the course contents:

- An empty course is permanently deleted.
- A course with content, enrollment, or submissions is soft-deleted.

A soft-deleted course keeps its data but disappears from all lists and cannot be opened by anyone, including administrators. There is currently no in-app restore. Recovery requires database work or a backup.

An archived course must be restored before it can be deleted.

## System settings

Use **System Settings** to manage platform-wide behavior: general options (timezone, upload size, signup, session timeout, account lockout, audit retention), the submission queue, backups, hCaptcha, the TLS certificate, and in-app updates.

Every setting, with its default and allowed range, is documented in [System settings](../operations/system-settings.md).

## System status

The **System Status** page reports application, database, container, network, session, and file health.

Check it periodically, not only after a failure. The **Files** tab identifies orphaned uploads, which are files on disk without a matching database record, and provides a safe cleanup action.

## Audit log

AFCT records important activity, including:

- Sign-ins and security denials
- Course and roster changes
- Grade overrides
- Submit-on-behalf actions
- Password resets
- Account lifecycle changes

Entries include a severity of `INFO`, `WARNING`, `ERROR`, or `SECURITY`. Actions involving another user record both the actor and the target.

The audit log is append-only. Entries cannot be edited or deleted through the application. Retention pruning follows the system setting.

Administrators can filter the log and export results to CSV.

## Backups and recovery

Create an on-demand backup before a risky maintenance action.

Soft-deleted course data remains in PostgreSQL, but there is no application screen for restoring it. Recovery may involve a targeted database update or a full backup restoration.

Choose a retention period based on how long a mistake might go unnoticed. Keep copies off the AFCT host.

## Operational environment

- `NEXTAUTH_SECRET` must be at least 32 characters. Changing it signs every user out.
- `DATABASE_URL` connects the application, migrations, and seed process to PostgreSQL.
- Production setup and maintenance are documented under [Production deployment](../setup/production.md).
