# Courses

The administrator **Courses** page lists every active course. It is the starting point for creating a course and for course lifecycle actions that Faculty and TAs cannot perform.

## Create a course

1. Select **Create Course**.
2. Enter the course name, code, semester, and credits.
3. Choose the timezone before entering the course and registration dates.
4. Select at least one Faculty member. Add TAs if they are already known.
5. Choose the empty string notation.
6. Review the details and create the course.

New courses begin unpublished. Open the course after creation to add students and content, then publish it when it is ready.

## Read the course list

The table includes the course name, code, credits, semester, registration status and code, dates, and assigned Faculty. Select the course name to open it.

Use the table search, sorting, filters, and column controls when the installation contains many courses.

## Duplicate a course

Open **Manage**, then select **Duplicate Course**. The wizard lets you set new details and dates, choose content, and assign the new Faculty and TAs.

The available copy modes are:

- Assignments only
- Assignments and their problems
- Problems only

The new course gets a new registration code, selected Faculty and TA roster entries, and no student enrollments. It starts unpublished.

Duplication intentionally resets several assignment-level values. Copied assignments start unpublished and do not retain group mode or late-work settings. When problems are copied with assignments, the links use default points, attempt limits, and automatic-grading settings rather than the source assignment's overrides. Review every copied assignment, problem link, deadline, and answer file before publishing the new course.

## Archive and restore

Open **Manage** and select **Archive Course** to make a course read-only. Archived courses move to the **Archived Courses** page in the dashboard sidebar.

An in-session course cannot be archived after it has submissions or grades. This safeguard prevents active student work from being frozen accidentally. A course outside its start and end dates can be archived.

To make an archived course editable again, open **Archived Courses**, choose **Manage**, and select **Restore Course**.

## Delete a course

An archived course must be restored before it can be deleted. From the active course list, open **Manage** and select **Delete Course**.

AFCT permanently deletes an empty course. If the course has assignments, problems, enrollment, or submissions, AFCT keeps the data but hides the course from every user. There is no in-app restore for a deleted course.

Create a current [backup](../operations/backups.md) before deleting a course whose data may be needed later.
