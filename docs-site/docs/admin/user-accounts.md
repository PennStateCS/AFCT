# User Accounts

The **User Accounts** page lists every AFCT account. Administrators can create and import accounts, update account details, grant administrator access, reset passwords, change login emails, deactivate and reactivate accounts, and delete inactive accounts.

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

The table shows only **active** accounts by default. To include deactivated accounts, open the **Status** filter and add **Inactive** (or clear the filter).

Open **Manage** for account actions.

## Edit an account

Select **Edit User Profile** to update the person's name, timezone, profile photo, or administrator access.

AFCT protects a few account changes:

- You cannot remove the final active administrator.
- A user in an active, published course cannot be deactivated.
- Inactive accounts cannot sign in.

## Deactivate or reactivate an account

Account status controls whether a person can sign in. It has its own confirmed action so the change is deliberate.

- **Deactivate.** Open **Manage** and select **Deactivate Account**, then confirm. The account can no longer sign in to AFCT (or the submission client), but its records are kept. You cannot deactivate the last active administrator, or a user still on an active, published course.
- **Reactivate.** For a deactivated account, open **Manage** and select **Reactivate Account**, then confirm. The person can sign in again.

Only one of the two actions shows at a time, depending on the account's current status.

## Change the login email

Select **Change Email Address** to move an account to a new email. This changes the address the person signs in with. AFCT checks that the new address is not already in use before saving; the field will not accept an address that belongs to another account.

## Reset a password

Select **Reset Password**, enter and confirm the new password, then choose whether it is temporary. A temporary password requires the user to change it at the next sign-in.

Send the new password through an appropriate private channel. AFCT does not show it again after the reset.

:::tip People can reset their own passwords
If [email is configured](system-settings.md#email), a **Forgot your password?** link appears on
the sign-in page and people can recover their own accounts without you. The link they receive
works once and expires in an hour, and using it signs them out of AFCT everywhere else. That is
usually better than relaying a password by hand.

Deactivated accounts are never sent a reset link, so deactivating someone closes that route as
well as the sign-in page.
:::

## Desktop client tokens

The AFCT desktop client signs in with a token rather than a password. Anyone can create their
own from **Account → App tokens**, name it so they can tell their machines apart, and revoke it
when they stop using one.

A token is shown once, when it is created. If someone loses it, they create another and revoke
the old one; there is no way to look it up again. Changing or resetting a password revokes every
token issued beforehand.

## Locked accounts

AFCT temporarily locks an account after too many failed sign-in attempts, to slow down password guessing. The lock expires on its own after the configured window, so most locks clear without any action.

- **See which accounts are locked.** A locked account shows a **Locked** badge with a live countdown of the time remaining on its row. Use the table's lock-status filter to list only locked accounts.
- **Unlock immediately.** Open **Manage** and select **Unlock Account**, then confirm. This clears the lock right away so the person can sign in. Repeated failed sign-ins can lock the account again.

The number of failed attempts before a lockout and how long a lock lasts are set in **System Settings → General** (*Failed logins before lockout* and *Account lockout duration*). For how account lockout and the separate per-IP limits work under the hood, see [Login protection](../reference/login-protection.md).

## Delete an account

The **Delete Inactive User** action is enabled in the interface only after the account has been made inactive. You cannot delete your own signed-in administrator account.

:::danger
Account deletion is permanent. Deleting an account can also remove course-linked records owned by that user through database relationships. Activity log entries are kept, but without the link to the deleted user.
:::

Prefer inactive status for a real account. Delete only accounts created by mistake or used for testing, and confirm their data is not needed first.
