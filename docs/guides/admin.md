# Administrator guide

Audience: system administrators. Administrator is a global role. You can act anywhere in the system and are not tied to any single course. Course content is the job of faculty (see the [faculty guide](faculty.md)); you handle accounts, platform settings, and the health of the server.

## Accounts

From the Users page you can:

- Create, disable, and delete users.
- Grant or revoke the administrator flag.
- Unlock an account that failed logins have locked.
- Reset any user's password.

Disabling an account signs it out everywhere and blocks sign in. Email addresses are permanent: no one can change a user's email once the account exists.

## System settings

Found under System Settings, grouped as follows.

**General**
- Timezone: the server default zone. New courses inherit it as their deadline zone.
- Maximum upload size: the cap on submission and avatar files.
- Allow user signup: turns self registration on or off.
- Allowed signup email domains: restrict self registration to one or more domains. Leave blank to allow any domain.
- 24-hour clock: a display preference for times across the app. It never changes stored times or deadlines.

**Sessions and lockout**
- Idle session timeout: how long an inactive session stays valid.
- Login attempts and lockout duration: brute force protection.

**Submission queue**
- Concurrency, retry attempts, resubmit cooldown, evaluation timeout, memory limit, and analyzer bound. These govern how the autograder processes submissions. The defaults are sound; change them only with a reason.

**Backups**
- Enable daily backups, set the hour they run, and choose how many days to keep.

**Audit log retention**
- How long audit entries are kept before automatic pruning.

**Security keys**
- hCaptcha site and secret keys for signup protection. The secret is write only and is never shown back.
- TLS certificate management.

## System status

The System Status page reports server, database, container, network, session, and file health. Use it to confirm the platform is healthy and to catch problems early.

## Audit log

Every significant action is recorded, including security events. The log is append only. No one, including you, can edit or delete an entry. Retention pruning is automatic.

## Backups and recovery

Backups run on the schedule you set and can also be triggered on demand. Deleting a course is a soft delete: the data is retained and recoverable, not destroyed. You keep direct access to a deleted course for recovery.

## Archived courses

Archiving freezes a course. Everyone, including administrators, is blocked from changing it. Only an administrator can un-archive. This is deliberate: it protects a finished term's record while keeping it readable.
