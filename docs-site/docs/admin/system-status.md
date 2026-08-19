# System Status

The **System Status** page gives administrators a live view of the AFCT installation. Use it for routine checks and as the first in-app stop when the site, database, evaluator, or sign-in flow behaves unexpectedly.

## Summary and refresh

The summary shows uptime, process CPU and memory, database table count and size, recent sessions, unique users, and response latency. Badges report database reachability and the database provider.

Select **Refresh** for a new snapshot, or turn on **Auto-refresh** to update every 15 seconds. The trend window can show changes over the last 1, 6, or 24 hours. Trend history is local to the browser and is not a long-term monitoring service.

## Status tabs

| Tab          | What to check                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Server**   | Maintenance the server itself needs, plus CPU, memory, disk activity, software versions, environment, hostname, and network interfaces. |
| **Database** | Connection health, provider, version, migration, size, table count, and database performance.                               |
| **Docker**   | Container identity, hostname, and cgroup information. A non-container installation reports that Docker data is unavailable. |
| **Network**  | Database and authentication latency, connection counts, error rates, DNS results, and configured hosts.                     |
| **Session**  | Session counts and accounts seen during the last 24 hours, including recent IP and user-agent details.                      |
| **Files**    | Uploaded files that exist on disk without a matching database record.                                                       |
| **Rate Limits** | IP addresses AFCT is currently turning away for making too many requests.                                                |

## What the server itself needs

The **This server** section on the Server tab reports on the machine AFCT runs on, rather than on AFCT:

- **A restart is waiting.** Updates have been installed that only take effect after the server is restarted. Restart it when nobody is using AFCT, because everyone signed in is signed out and grading stops until it comes back.
- **Security updates are waiting.** Ask whoever administers the server to install them.
- **The clock has drifted.** Worth fixing promptly. A launch from Canvas, Moodle or Blackboard is signed and timestamped, and platforms refuse one whose clock disagrees with theirs by more than a few minutes.

When something needs attention, a **Server needs attention** badge also appears beside the page title.

This information comes from the update service, which is the only part of AFCT allowed to see the machine (the application itself is deliberately walled off from it, because that is where submissions are graded). If that service is not running, or the server does not run Ubuntu or Debian, the section says AFCT cannot tell rather than reporting that everything is fine. Installing the updates themselves is always done on the server, never through AFCT.

## Remove an abandoned file

The **Files** tab groups abandoned files by category and shows a sample of up to 50. A file appears here when AFCT finds it on disk but cannot find the database record that should own it.

Before selecting **Delete**:

1. Confirm the category and exact file name.
2. Check recent [System Logs](system-logs.md) for a failed upload or interrupted database operation.
3. Make sure a current backup contains uploaded files.

Deleting an abandoned file is permanent. If you are unsure why it exists, leave it in place while you investigate.

## Rate-limited addresses

AFCT slows down and then temporarily refuses an address that makes too many sign-in attempts, account sign-ups, or email-availability checks in a short time. This is what stops password guessing and bulk account enumeration; see [Login protection](../reference/login-protection.md) for the thresholds.

The **Rate Limits** tab lists every address currently being refused, and for each one shows:

- the **reason**, and whether the address is fully **Blocked** or only **Challenged** (asked to complete a captcha);
- when the restriction **began**;
- **recent activity**: how many attempts were counted, how many have been turned away since, and the time of the most recent one;
- when the restriction **expires** on its own.

### What AFCT can tell you about the address

Alongside each restriction, the tab shows whatever it could establish about the address itself, which is usually enough to answer "is this us?":

- the **reverse-DNS name**, if the address has one. A name like `lab-12.cs.example.edu` identifies a campus machine at a glance. Many addresses have no name, and that is normal.
- **what kind of address it is**: a public internet address, a private network address, this server itself, or a carrier-shared address (one that many mobile subscribers sit behind, so restricting it affects more people than usual).
- **Seen before**: whether this address appears in AFCT's own activity log in the last 30 days, how many accounts have used it, how busy it has been, and when it was last seen. An address with a dozen accounts behind it is a shared one, a lab or an office, and is the strongest sign that a restriction is catching innocent people.

AFCT does not look addresses up with any outside service, so nothing about your visitors is sent anywhere, and this works the same on an installation with no internet access. That also means there is no city, country, or internet-provider name to show: the activity log is the better answer to the question you are actually asking.

Two things to keep in mind when reading the list. Restrictions are held in the running application's memory, so the list covers the instance you are connected to and empties whenever AFCT restarts. And a restriction applies to an address, not a person: a computer lab, a library, or a campus network can put dozens of students behind one address.

### Clear a rate limit

Every restriction lifts by itself at the time shown, so waiting is usually the right answer. Clear one early only when you know the traffic is legitimate, most often a shared address where one person's mistyped password has shut out a whole room.

Select **Clear** on the row and confirm. The address can make those requests again immediately, and AFCT records the action in the [System Logs](system-logs.md) with your account, the address, and the time, so lifting a protection is always traceable. If the address is still under attack it will simply be restricted again on the next burst.

Clearing a rate limit is not the same as unlocking an account. A locked *account* is cleared from [User Accounts](user-accounts.md); this tab only affects addresses.

For host-level checks and commands, continue with [Production troubleshooting](../operations/troubleshooting.md).
