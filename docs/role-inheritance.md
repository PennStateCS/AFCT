# Role Inheritance and Course Roles

## Summary
- Users have a global `role` (enum `Role`): `ADMIN`, `FACULTY`, `TA`, `STUDENT`.
- Per-course roles are stored in `Roster.role` (enum `CourseRole`): `INSTRUCTOR`, `FACULTY`, `TA`, `STUDENT`.
- Enrollment mapping:
  - Global `FACULTY` and `ADMIN` are assigned `FACULTY` in a course by default; `INSTRUCTOR` is assigned explicitly.
  - `TA` -> `TA`.
  - `STUDENT` -> `STUDENT`.

## Permissions & Rules (Server-side)
- Global role changes may only be performed by global `ADMIN` (`PATCH /api/users/:id`).
- Per-course role changes may be performed by **global `ADMIN`** or the course's **`INSTRUCTOR`** (`PATCH /api/courses/:courseId/roster/:userId`).
- Removing a roster member is allowed for **global `ADMIN`**, **course `INSTRUCTOR`**, and **FACULTY**, subject to constraints:
  - Cannot remove a user who has submissions in the course (server enforces this).
  - Cannot remove or demote the only faculty member in the course.
  - **FACULTY** cannot remove `INSTRUCTOR` or other `FACULTY` members.
  - **INSTRUCTOR** cannot remove other `INSTRUCTOR` members.

## API Details / Responses
- `GET /api/courses/:id` now returns `viewerRole` (the viewer's role in the course) and `viewerDefaultRole` (the viewer's global role) to let the UI make permission-based decisions.
- `GET /api/courses/:id/roster/:userId` now returns the roster entry with the related `user` profile and also the viewer's `viewerCourseRole` and `viewerDefaultRole` when requested by an authenticated viewer.
- Enrollment endpoints (`POST /api/courses/:id/enroll` and `POST /api/courses/:id/bulk-enroll`) assign the roster role according to the mapping above.

## UI / UX
- Roster table displays the per-course `role` for each user.
- The **Actions** column is only shown to viewers who can act on roster entries (site `ADMIN`, `INSTRUCTOR`, or `FACULTY`).
- The previous "Manage" dropdown was replaced with a compact **Edit** control that opens `CourseEditUserDialog`.
  - Site `ADMIN` and course `INSTRUCTOR` use the dialog to edit per-course role and remove users.
  - `FACULTY` sees an inline delete button for permitted removals.
- `CourseEditUserDialog` supports:
  - Viewing the user's name/email and profile photo.
  - Deleting the user's profile photo (if viewer is ADMIN/INSTRUCTOR/FACULTY).
  - Removing the user from the course (uses a shared `ConfirmDialog`).
  - The dialog accepts an `initialRoster` fast-path (preloaded row data) so it opens instantly without waiting for a fetch when invoked from the roster table.
- `EditUserDialog` (global user edits) hides global role selector unless the viewer is a global `ADMIN`.

## Manual Tests
1. Enroll users of different global roles and confirm the course role mapping is correct.
2. As a course `INSTRUCTOR`, change a student's per-course role and verify the API and UI reflect the change.
3. As a faculty member, attempt to remove a `INSTRUCTOR` or another `FACULTY` member — it should be disallowed by the UI and server.
4. As a site `ADMIN`, remove a user who has no submissions; ensure removal succeeds and activity log records the action.
5. Open the course edit dialog from the roster table and verify it opens instantly (fast-path) and shows correct initial data.
