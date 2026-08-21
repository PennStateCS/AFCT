# Administrator guide

**Audience:** AFCT system administrators

Administrator access is controlled by the global administrator setting on a user account. It is separate from course roles. An administrator can also be enrolled as Faculty or a TA in a course, and both sets of permissions apply.

The **Administration** menu contains the platform-wide tools:

| Page                                               | What it is for                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Courses](../admin/courses.md)                     | Create, duplicate, archive, restore, and delete courses.                         |
| [Submissions](../admin/submissions.md)             | Review and rerun submissions across courses.                                     |
| [Evaluator Sandbox](../faculty/evaluator-sandbox.md) | Run two files through the autograder on their own, with no course or grade.    |
| [System Logs](../admin/system-logs.md)             | Search the system audit trail and export records.                                |
| [System Settings](../admin/system-settings.md)     | Configure accounts, uploads, the evaluator, backups, security, TLS, and updates. |
| [System Status](../admin/system-status.md)         | Check the server, database, Docker, network, sessions, and uploaded files.       |
| [User Accounts](../admin/user-accounts.md)         | Create, import, edit, disable, and delete accounts.                              |

:::warning
Administrator actions affect the entire AFCT installation. Review the target and confirmation message carefully before deleting a course, deleting an account, removing an abandoned file, or restoring an older application version.
:::

Two of these are once-per-installation jobs rather than daily ones. [Connect your
LMS](../admin/lms-connection.md) registers Canvas, Moodle, Brightspace or Blackboard so courses
can be opened from it, and [System Settings](../admin/system-settings.md) is where accounts,
uploads, the evaluator, email, security and TLS are configured.

Keeping the installation running is covered separately: [update AFCT](../operations/updates.md),
[manage backups](../operations/backups.md), and
[troubleshoot a deployment](../operations/troubleshooting.md).

See [Roles and permissions](../reference/roles-and-permissions.md) for the authorization model.

:::note
A **Development Tests** page also appears in this menu on a development build. It is hidden in
production, and it is documented under
[Development Tests](../reference/development-tests.md) with the rest of the developer material.
:::
