# Settings

Use **Settings** to control the course details, dates, registration window, notation, and publication status.

## Course details

The settings form includes:

- **Course Name**, the full title students see
- **Course Code**, the short identifier, which AFCT saves in uppercase
- **Semester**
- **Credits**, from 1 through 6
- **Course timezone**
- **Start Date & Time** and **End Date & Time**
- **Self Registration Opens** and **Self Registration Closes**
- **Empty string notation**, either epsilon or lambda

Each date field is a date box and a time box. Setting only the date fills the time in for you:
the start of the day for **Start Date & Time** and **Self Registration Opens**, and 23:59 for
**End Date & Time** and **Self Registration Closes**, since those are the end of a window.

Select **Save Changes** after editing these fields.

## Choose the timezone first

The course timezone controls how AFCT interprets course dates and every assignment deadline. Students may view a formatted time in their own context, but the deadline is anchored to the course timezone.

Set the timezone before creating assignments. If you change it later, review the course dates, registration window, and assignment deadlines to make sure they still represent the times you intended.

## Set the registration window

Students can use the course registration code only between **Self Registration Opens** and **Self Registration Closes**. The course must also be published.

These dates do not prevent Faculty or TAs from directly enrolling an existing AFCT account from the [Roster](roster.md) page.

## Publish the course

The **Published** switch is in the **Course Status** card. It takes effect as soon as you confirm it, so you do not need to select **Save Changes** afterward.

When published, enrolled students can see the course. When unpublished, only course staff and site administrators can open it.

AFCT will not let you unpublish a course that already has submissions or grades. If the switch cannot be turned off, preserve the course as published or ask a site administrator to help with the intended workflow.

## Connected LMS

When the course has been opened from a connected LMS, a **Connected to your LMS** card appears
below **Course Status**, beside the settings form. It names each LMS course this one is linked to
(a cross-listed course has several), offers **Sync roster from your LMS**, and lets you
**Disconnect**. Disconnecting stops grades being sent and removes the sync option; nothing already
in AFCT or already in your gradebook is removed. See
[Grades and rosters from your LMS](lms.md).

## Archived courses

An archived course is read-only. Its settings and publication switch cannot be changed. Archiving and restoring are site administrator actions and are available from the course list, not from this page.
