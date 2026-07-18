# System Logs

The **System Logs** page is the installation-wide audit trail. It records security events and important changes to users, courses, assignments, problems, submissions, and grades.

## Search and filter

The page opens with the newest records first. You can:

- Search all fields or limit the search to action, category, name, or email
- Filter by severity: Info, Warning, Error, or Security
- Filter by category: System, User, Course, Assignment, Problem, Submission, or Grade
- Sort supported columns
- Change pages and the number of rows shown

Select **Full Log** on a row to inspect its complete JSON record. This can include the action, actor, target identifiers, IP address, user agent, and related metadata.

## Download logs

1. Select **Download Logs**.
2. Choose the fields to include, or use **Select All**.
3. Set an optional start and end time.
4. Select **Download Logs** to create a CSV file.

Leave the date fields empty to include the full retained range. The exported records are useful for an investigation, but they can contain personal and security-related information. Store and share the CSV accordingly.

## Retention and interpretation

The retention period is configured under [System Settings](system-settings.md). Records older than that period are removed by the daily pruning job.

An Error or Security entry is a starting point, not always proof of a defect or attack. Read the full record, check nearby events, and compare it with [System Status](system-status.md) or server logs before deciding what happened.
