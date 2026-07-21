# User Accounts

The **User Accounts** page lists every AFCT account. Administrators can create and import accounts, update account details, grant administrator access, reset passwords, disable accounts, and delete inactive accounts.

## Create one account

1. Select **Create User**.
2. Enter the person's first name, last name, email address, and password.
3. Confirm the password and create the account.

Creating an account does not enroll it in a course. Add the person from a course roster or let the person join with a registration code.

## Import accounts from CSV

1. Select **Import Users**.
2. Upload a CSV with `first name`, `last name`, `email`, and `password` headers.
3. Turn on **Temporary passwords** if every imported user should choose a new password at the next sign-in.
4. Review the parsed and invalid row counts.
5. Select **Import Users**.

The import processes valid rows and reports failed rows separately. Fix only the failed rows before trying again. The only size limit on the file is the configured **Max upload size**.

## Find and review an account

The table shows the user's name, email, administrator flag, active status, password status, creation date, and last sign-in. Use sorting, search, filters, and column controls to narrow the list.

Open **Manage** for account actions.

## Edit an account

Select **Edit User Profile** to update the person's name, timezone, profile photo, administrator access, or active status. The email address is read-only because AFCT uses it as the permanent account identifier.

AFCT protects a few account changes:

- You cannot remove the final active administrator.
- A user in an active, published course cannot be made inactive.
- Inactive accounts cannot sign in.

If an email address is wrong, create a new account with the correct address and update the relevant course rosters.

## Reset a password

Select **Reset Password**, enter and confirm the new password, then choose whether it is temporary. A temporary password requires the user to change it at the next sign-in.

Send the new password through an appropriate private channel. AFCT does not show it again after the reset.

## Locked accounts

AFCT temporarily locks an account after too many failed sign-in attempts, to slow down password guessing. The lock expires on its own after the configured window, so most locks clear without any action.

- **See which accounts are locked.** A locked account shows a **Locked** badge with a live countdown of the time remaining on its row. Use the table's lock-status filter to list only locked accounts.
- **Unlock immediately.** Open **Manage** and select **Unlock Account**, then confirm. This clears the lock right away so the person can sign in. Repeated failed sign-ins can lock the account again.

The number of failed attempts before a lockout and how long a lock lasts are set in **System Settings → General** (*Failed logins before lockout* and *Account lockout duration*). For how account lockout and the separate per-IP limits work under the hood, see [Login protection](../reference/login-protection.md).

## Delete an account

The **Delete Inactive User** action is enabled in the interface only after the account has been made inactive. You cannot delete your own signed-in administrator account.

Account deletion is permanent and database relationships can remove course-linked records owned by that user. Activity log entries are retained without the deleted user link. Prefer inactive status for a real account, and delete only accounts created by mistake or used for testing after confirming that their data is not needed.
