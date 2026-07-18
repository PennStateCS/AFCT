# System Status

The **System Status** page gives administrators a live view of the AFCT installation. Use it for routine checks and as the first in-app stop when the site, database, evaluator, or sign-in flow behaves unexpectedly.

## Summary and refresh

The summary shows uptime, process CPU and memory, database table count and size, recent sessions, unique users, and response latency. Badges report database reachability and the database provider.

Select **Refresh** for a new snapshot, or turn on **Auto-refresh** to update every 15 seconds. The trend window can show changes over the last 1, 6, or 24 hours. Trend history is local to the browser and is not a long-term monitoring service.

## Status tabs

| Tab          | What to check                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Server**   | CPU, memory, disk activity, software versions, environment, hostname, and network interfaces.                               |
| **Database** | Connection health, provider, version, migration, size, table count, and database performance.                               |
| **Docker**   | Container identity, hostname, and cgroup information. A non-container installation reports that Docker data is unavailable. |
| **Network**  | Database and authentication latency, connection counts, error rates, DNS results, and configured hosts.                     |
| **Session**  | Session counts and accounts seen during the last 24 hours, including recent IP and user-agent details.                      |
| **Files**    | Uploaded files that exist on disk without a matching database record.                                                       |

## Remove an abandoned file

The **Files** tab groups abandoned files by category and shows a sample of up to 50. A file appears here when AFCT finds it on disk but cannot find the database record that should own it.

Before selecting **Delete**:

1. Confirm the category and exact file name.
2. Check recent [System Logs](system-logs.md) for a failed upload or interrupted database operation.
3. Make sure a current backup contains uploaded files.

Deleting an abandoned file is permanent. If you are unsure why it exists, leave it in place while you investigate.

For host-level checks and commands, continue with [Production troubleshooting](../operations/troubleshooting.md).
