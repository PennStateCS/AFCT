# Administrator guide

**Audience:** system administrators.

Administrator is a **global** capability: the `isAdmin` flag on your account. It
is not a course role, and it is not tied to any course. You can act anywhere in
the system, but the division of labor matters. Course *content* belongs to
faculty (see the [faculty and TA guide](faculty.md)). You own the things faculty
cannot or should not touch: accounts, platform settings, the course lifecycle,
and the health of the server. The precise permission model is spelled out in
[Roles and permissions](../reference/roles-and-permissions.md).

Because the admin flag is independent of course roles, you can also be enrolled
in a course as faculty. Both powers apply at once. Plenty of small departments
run this way, with one person wearing both hats.

---

## Accounts

The **Users** page is where every account gets managed. The operations are what
you would expect, but a few carry consequences worth thinking through before you
click.

You can **create** a user with a name, email, and password. A freshly created
account has no privileges and no enrollments; it can do nothing until you enroll
it in a course or the user joins one by code.

You can **disable** and **enable** accounts. Disabling signs the user out
everywhere immediately and blocks further sign-in; re-enabling restores access.
When you need to cut someone off, disable, don't delete. Disabling is
reversible, and it keeps the door open for the "wait, that was a mistake"
conversation that happens more often than you'd think.

You can **delete** an account, which removes it. For a user with any history,
disabling is the better call: their submissions and audit trail stay
attributable to a real account instead of pointing at a ghost. Deletion is for
accounts created in error, test accounts, and the like.

You can **toggle the administrator flag** to grant or revoke `isAdmin`. One
guard applies: you cannot remove your *own* admin flag. Without that rule, a
distracted afternoon could leave the system with no admin at all.

You can **unlock** an account that repeated failed logins have locked, rather
than making the user wait out the lockout. Useful the morning after a password
change, when someone has burned through their attempts before coffee.

You can **reset a password** on any user's behalf. If you mark it **temporary**,
the user is forced to choose a new one at their next login, which is the right
setting almost every time: you should not know a password the user will keep.
The plaintext is never stored, logged, or shown back to you.

One rule stands above the rest: **email is permanent.** Nobody can change an
account's email once it exists. Not the user, not staff, not you. The email is
the account identifier, and everything hangs off it. If someone was created
with the wrong address, the fix is a new account, not an edit.

### Bulk account creation

At the start of a term you rarely create accounts one at a time; you import them
from a roster spreadsheet. The import validates each row independently. Valid
rows are created, and rows that fail (a missing field, a malformed email, a
password that doesn't meet the strength policy, or an email already in use) are
reported back per row. You fix the bad rows and re-import; the rows that already
succeeded don't block you. You can also force temporary passwords for the whole
batch, which you should, for the same reason as above: nobody but the user
should hold a password that lasts.

---

## Signup and access control

Under **System Settings** you decide whether people can create their own
accounts at all.

**Allow user signup** turns public self-registration on or off. With it off,
you are the only source of accounts, which suits a small deployment where you
import every roster yourself.

**Allowed signup email domains** restricts self-registration to an approved
list, typically your institution's domains. Leave it blank to allow any domain.
A signup attempt from a non-approved domain is refused even when signup is on,
so you can leave signup open without opening it to the whole internet.

Signup is also protected by rate limiting (escalating friction, then a captcha
challenge, then a temporary block) and by the password strength policy, so a
bot hammering the signup form gets progressively less traction.

---

## Courses (the admin's part of the lifecycle)

Faculty run their own courses day to day. A handful of lifecycle actions are
reserved to you, and the pattern is consistent: anything that creates, freezes,
thaws, or destroys a course is admin-only, while everything in between belongs
to the people teaching it.

You **create** a course and assign its faculty. New courses start unpublished,
so nothing is visible to students until the faculty are ready.

You **duplicate** a course, which is the fast way to roll a course into a new
term. The copy carries over settings, assignments, and problems, including
answer files, points, caps, and autograde flags. It does **not** copy the
roster: the copy starts empty and unpublished, waiting for you to staff it.
Last spring's students have no business appearing in this fall's section, so
the empty roster is the point, not a limitation.

You **delete** a course, from the **Manage** menu on the course list. Deletion
adapts to what the course holds. An **empty** course (no assignments, problems,
students, or submissions) is removed **permanently**; there is nothing to lose.
Any course with real content or enrollment is **soft-deleted** instead: it gets
a `deletedAt` stamp, all of its data is retained, and it disappears from every
list and becomes **inaccessible to everyone, admins included** (no one can open
it by direct URL). The confirmation dialog tells you which will happen before you
commit. Recovery of a soft-deleted course is currently out-of-band (database or
backup); there is no in-app restore yet. You cannot delete an **archived**
course directly; restore it first, then delete.

You **archive** and **restore** (un-archive) a course. Archiving freezes a
course read-only for *everyone*, admins included; restoring lifts that freeze.
**Both are admin-only.** Faculty cannot archive or restore a course, because a
finished term's record should be frozen and thawed only by someone outside its
day-to-day.

Publishing, editing, and roster changes are ordinary staff actions. You can do
them too, but nothing about them is reserved to you.

---

## System settings

Everything below lives under **System Settings**, grouped as follows.

**General**

- **Timezone** is the server default zone. New courses inherit it as their
  deadline zone, and faculty can override it per course. Set it to wherever
  most of your courses actually meet.
- **Maximum upload size** caps submission and avatar files.
- **Allow user signup** and **Allowed signup email domains** are covered above.
- **24-hour clock** is a display preference for times across the app. It never
  changes stored times or deadline enforcement; it only changes what people
  read on screen.

**Sessions and lockout**

- **Idle session timeout** (default 60 min, range 5-1440) is how long an
  inactive session stays valid. Enforcement is server-side: an active client
  gets a warning and a graceful sign-out first, and the server rejects a stale
  session as a backstop. A closed laptop lid does not keep a session alive
  past the window.
- **Login max attempts** (default 10, range 3-50) and **Lockout duration**
  (default 45 min, range 1-1440) are the brute-force protection. When a locked
  student emails you mid-exam-week, you can unlock early from the Users page
  instead of telling them to wait.

**Submission queue**

These govern how the autograder processes submissions. The defaults are sound;
change them only when you can articulate why. If the queue is keeping up and
students are getting results, leave it alone.

- **Concurrency** (default 5, range 1-20) is how many submissions evaluate at
  once. Raising it trades server load for throughput; the only time it matters
  is the hour before a deadline.
- **Retry attempts** (default 3, range 1-10) is the poison-pill guard. A
  submission that keeps failing is given up on after this many tries, so one
  pathological submission cannot wedge the queue forever.
- **Resubmit cooldown** (default 10 s, range 0-3,600,000 ms) is the minimum gap
  between a student's resubmissions to the same problem. It stops the
  guess-and-resubmit loop from becoming a denial of service.
- **Evaluation timeout** (default 30 s, range 1-600) and **memory limit**
  (default 256 MB, range 64-8192) are the per-run wall-clock and JVM heap caps.
- **Analyzer bound** (default 15, range 1-100) is the CFG-analyzer limit.

The pool re-reads these every 30 seconds, so changes take effect without a
restart. You can tune the queue during a deadline crunch without kicking anyone
off.

**Backups**

Enable daily backups, set the hour they run, and choose how many days to keep.

**Audit log retention**

How long audit entries are kept before automatic pruning.

**Security keys**

- **hCaptcha** site and secret keys for signup protection. The secret is
  write-only; once saved it is never shown back, so keep your own record of it.
- **TLS certificate management** lets you generate a CSR, install a signed
  certificate, or fall back to a self-signed one.

---

## System status

The **System Status** page reports server, database, container, network,
session, and file health across per-domain tabs. Glance at it now and then, not
just when something breaks; the point is catching problems before a student
does. The **Files** tab reports orphaned uploads, meaning files on disk with no
database row, and lets you clean them up safely.

---

## Audit log

Every significant action is recorded: logins, course and roster changes, grade
overrides, submit-on-behalf, password resets, account lifecycle changes, and
every security denial. Entries carry a severity (`INFO`, `WARNING`, `ERROR`,
`SECURITY`) and, for actions on a student, both the actor and the target, so a
grade dispute months later has a paper trail with names on it.

The log is **append-only**. No one, including you, can edit or delete an entry.
That is what makes it worth anything: an audit log an admin can rewrite is just
a diary. Retention pruning runs automatically on the schedule you set. You can
view and filter the log and export a slice to CSV when someone outside the
system needs to see it.

---

## Backups and recovery

Backups run on the schedule you set and can also be triggered on demand, which
is worth doing right before anything you might regret. A course delete either
removes an empty course permanently or soft-deletes a non-empty one (a
`deletedAt` stamp, data retained). A soft-deleted course still exists in the
database, so recovering it is a targeted un-delete at the data layer rather than
a full restore, but there is no in-app restore yet, so treat any delete as
consequential and take an on-demand backup first when in doubt.
Size the retention window against how long a mistake can go unnoticed, not how
long it takes to notice one. A course deleted during finals might not be missed
until the grade appeal in February.

---

## Archived courses

Archiving freezes a course. Everyone, including administrators, is blocked from
changing it, while staff and admins can still read it. Students cannot access
an archived course at all. **Archiving and restoring are both admin-only.** This
is deliberate: a finished term's record should be protected from casual edits
but stay readable for grade disputes, accreditation reviews, and the occasional
"what did I assign in 2024" question. Archived courses live on their own
**Archived Courses** page rather than the main course list.

---

## Operational notes

- **`NEXTAUTH_SECRET`** must be set to a strong value (at least 32 characters)
  in the environment; the app refuses to start at runtime without it. Generate
  one with `openssl rand -base64 32`. Know before you rotate it: rotating signs
  everyone out, so do it between terms or announce it, not silently on a
  Tuesday.
- **`DATABASE_URL`** points the app (and migrations/seed) at Postgres.
- Deployment, TLS, and the reverse proxy are covered in
  [`production.md`](../setup/production.md).
