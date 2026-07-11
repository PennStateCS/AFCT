# Administrator guide

**Audience:** system administrators.

Administrator is a **global** capability — the `isAdmin` flag on your account. You
can act anywhere in the system and are not tied to any single course. Course
*content* is the job of faculty (see the [faculty and TA guide](faculty.md)); you
own accounts, platform settings, the course lifecycle, and the health of the
server. For the precise permission model, see [Roles and permissions](../role-inheritance.md).

Being an admin is independent of any course role: you can also be enrolled in a
course as faculty, and both powers apply.

---

## Accounts

The **Users** page is where you manage every account.

- **Create** a user (name, email, password). New accounts have no privileges and
  no enrollments until you enroll them or they join by code.
- **Disable / enable.** Disabling an account signs it out everywhere immediately
  and blocks sign-in. Re-enabling restores access. Disable is the reversible way
  to cut off access; prefer it over deletion.
- **Delete.** Removes the account. A user with history is better disabled than
  deleted so their submissions and audit trail stay attributable.
- **Toggle the administrator flag.** Grant or revoke `isAdmin`. You cannot remove
  your *own* admin flag (a guard prevents locking yourself out of admin).
- **Unlock** an account that repeated failed logins have locked, without waiting
  for the lockout to expire.
- **Reset a password.** Set any user's password on their behalf. You can mark it
  **temporary**, which forces the user to choose a new one at their next login.
  The plaintext is never stored, logged, or shown back.

**Email is permanent.** No one — not the user, not staff, not an admin — can
change an account's email once it exists; it is the account identifier.

### Bulk account creation

You can import many users at once (for example from a roster spreadsheet). Each
row is validated independently: valid rows are created, and rows that fail
(missing fields, bad email, weak password, or an email already in use) are
reported back per row so you can fix and re-import. You can force temporary
passwords for the whole batch.

---

## Signup and access control

Under **System Settings**:

- **Allow user signup** turns public self-registration on or off. With it off,
  only you can create accounts.
- **Allowed signup email domains** restricts self-registration to an approved
  list (for example your institution's domains). Leave it blank to allow any
  domain. A signup from a non-approved domain is refused even when signup is on.
- Signup is additionally protected by rate limiting (escalating friction → a
  captcha challenge → a temporary block) and the password strength policy.

---

## Courses (the admin's part of the lifecycle)

Faculty run their courses, but a few course-lifecycle actions are **admin-only**:

- **Create** a course and assign its faculty. New courses start unpublished.
- **Duplicate** a course. The copy carries over settings, assignments, and
  problems (including answer files, points, caps, and autograde flags) but **not**
  the roster — it starts empty and unpublished for you to staff.
- **Delete** a course. This is a **soft delete**: `deletedAt` is stamped, all data
  is retained and recoverable, and the course disappears from every list. You keep
  direct-URL access for recovery.
- **Un-archive** a course. Archiving freezes a course read-only for *everyone*,
  admins included; only you can lift the freeze.

Publishing, archiving, editing, and roster changes are staff actions — you can do
them too, but they are not reserved to you.

---

## System settings

Found under **System Settings**, grouped as follows.

**General**
- **Timezone** — the server default zone. New courses inherit it as their deadline
  zone (faculty can override per course).
- **Maximum upload size** — the cap on submission and avatar files.
- **Allow user signup** and **Allowed signup email domains** — see above.
- **24-hour clock** — a display preference for times across the app. It never
  changes stored times or deadline enforcement.

**Sessions and lockout**
- **Idle session timeout** (default 60 min, range 5–1440). How long an inactive
  session stays valid. It is enforced server-side; an active client is warned and
  signed out gracefully first, and the server rejects a stale session as a backstop.
- **Login max attempts** (default 10, range 3–50) and **Lockout duration**
  (default 45 min, range 1–1440). Brute-force protection. You can unlock early
  from the Users page.

**Submission queue** — these govern how the autograder processes submissions. The
defaults are sound; change them only with a reason.
- **Concurrency** (default 5, range 1–20) — how many submissions evaluate at once.
- **Retry attempts** (default 3, range 1–10) — a submission that keeps failing is
  given up on after this many tries (the poison-pill guard).
- **Resubmit cooldown** (default 10 s, range 0–3,600,000 ms) — minimum gap between
  a student's resubmissions to the same problem.
- **Evaluation timeout** (default 30 s, range 1–600) and **memory limit**
  (default 256 MB, range 64–8192) — per-run wall-clock and JVM heap caps.
- **Analyzer bound** (default 15, range 1–100) — the CFG-analyzer limit.

The pool re-reads these every 30 seconds, so changes take effect without a restart.

**Backups**
- Enable daily backups, set the hour they run, and choose how many days to keep.

**Audit log retention**
- How long audit entries are kept before automatic pruning.

**Security keys**
- **hCaptcha** site and secret keys for signup protection. The secret is
  write-only and is never shown back.
- **TLS certificate management** — generate a CSR, install a signed certificate,
  or fall back to a self-signed one.

---

## System status

The **System Status** page reports server, database, container, network, session,
and file health across per-domain tabs. Use it to confirm the platform is healthy
and to catch problems early. The **Files** tab reports orphaned uploads (files on
disk with no database row) and lets you clean them up safely.

---

## Audit log

Every significant action is recorded — logins, course and roster changes, grade
overrides, submit-on-behalf, password resets, account lifecycle changes, and every
security denial. Entries carry a severity (`INFO`, `WARNING`, `ERROR`, `SECURITY`)
and, for actions on a student, the actor and target.

The log is **append-only**. No one, including you, can edit or delete an entry;
retention pruning runs automatically on the schedule you set. You can view and
filter it and export a slice to CSV.

---

## Backups and recovery

Backups run on the schedule you set and can also be triggered on demand. Because a
course delete is a soft delete, most "recovery" is simply un-deleting or
un-archiving rather than restoring a backup. Keep the retention window long enough
to cover the gap between a mistake and its discovery.

---

## Archived courses

Archiving freezes a course: everyone, including administrators, is blocked from
changing it, while staff and admins can still read it. Students cannot access an
archived course at all. **Only an administrator can un-archive.** This is
deliberate — it protects a finished term's record while keeping it readable.

---

## Operational notes

- **`NEXTAUTH_SECRET`** must be set to a strong value (at least 32 characters) in
  the environment; the app refuses to start at runtime without it. Generate one
  with `openssl rand -base64 32`. Rotating it signs everyone out.
- **`DATABASE_URL`** points the app (and migrations/seed) at Postgres.
- Deployment, TLS, and the reverse proxy are covered in
  [`production_setup.md`](../production_setup.md).
