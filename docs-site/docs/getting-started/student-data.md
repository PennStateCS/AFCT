# What AFCT stores about students

Adopting AFCT usually means a conversation with someone in your privacy, IT or registrar's office.
This page is written to be handed to them. It describes what the software stores, where it stores
it, and who can read it.

It is a description of how AFCT works, not legal advice. Whether a particular use meets your
institution's obligations is a question for your institution.

## Where the data lives

**On your own server.** AFCT is self-hosted: you install it on a machine your institution
controls, and student records stay there. There is no AFCT service, no shared cloud tenancy, and
no telemetry sent anywhere.

The software makes outbound network requests in only a few places, all of them ones you turn on
deliberately:

- To your LMS, if you connect one, to send grades back and read the roster.
- To your institution's identity provider, if you enable institutional sign-in.
- To your mail server, if you configure email.
- To GitHub, to check for a newer AFCT version and download it when you ask.
- To hCaptcha, if you enable it, on sign-in pages.

The container that grades submissions has **no network access at all**. Student work is evaluated
on an isolated container that cannot reach the internet or the rest of the network.

## What is stored about a person

**Account.** Email address, first and last name, an optional profile photo and timezone, and
whether the account is active. A password is stored only if the person has one; it is hashed, not
kept in a readable form. Someone who only ever signs in through an LMS or their university account
has no password stored at all.

**Course membership.** Which courses a person is in and their role in each (faculty, TA or
student), plus whether they have been dropped.

**Coursework.** Every file a student submits, the result the autograder gave it, the feedback
returned, grades per problem and per assignment, and any comments on the work. Files are kept, not
just their results, because a grade you cannot show the work behind is not much use in a dispute.

**Activity log.** Who did what, and when. Each entry records the person, the action, the course,
assignment, problem or submission it concerned, the time, and the IP address and browser the
request came from.

## The activity log deserves its own paragraph

It is the record of who changed a grade and who looked at a student's work. Under FERPA that makes
it both an education record in itself and the evidence behind a disclosure record, so it is
deliberately hard to weaken: entries are append-only, the app never edits or deletes an individual
one, and the severity of each entry is set explicitly at the point it is written rather than
guessed afterwards.

Only administrators can read the whole log. Faculty and TAs can read the activity for a course
they run, and nothing outside it. Students cannot read it at all.

Entries are removed on a retention schedule, one year by default, which an administrator can
change in System Settings. That is the only thing that deletes them.

## Who can see what

Access is a global administrator flag plus a role in each course.

| | Sees |
| --- | --- |
| **Student** | Their own work, grades and feedback, in courses they are enrolled in. On a group assignment, their group's submissions, because the work belongs to the group. |
| **TA** | Everything inside the courses they are assigned to, and nothing outside them. |
| **Faculty** | The same as a TA for their own courses, plus the ability to change roles and grades. |
| **Administrator** | The whole installation, including every course and the full activity log. |

Faculty is not the same as administrator. A professor running two courses cannot see a third.

Two details worth knowing: a student who has been **dropped** from a course keeps their roster row
and their work, but loses access to the course everywhere, including from the native client. And
a student is never shown another student's submission, with the single deliberate exception of
their own groupmates on group work.

## Getting data out

Grades export as CSV from the course, which is what makes AFCT usable alongside whichever system
your institution treats as the system of record. AFCT is not designed to be that system: it sits
beside your LMS rather than replacing it.

Where a course is connected to an LMS, grades are sent back to that gradebook automatically.

## Deleting data

Deletions in AFCT are mostly **soft**: the record is marked deleted and stops appearing, rather
than being erased. That is deliberate, because a submission or a grade that vanishes silently is
the worst failure this kind of system can have.

Where a genuine erasure is required, it is an administrator action on the account, and the
[User Accounts](../admin/user-accounts.md) page covers what it does and does not remove.

Backups are a separate question. They are encrypted, they contain a complete copy of everything
above, and they persist for as long as your retention setting says. Anyone planning a deletion
process needs to account for them.

## Backups and encryption

Backups are encrypted with a passphrase you provide, using symmetric AES-256, so an archive that
leaks is not readable. The corollary is the part people miss: **without the passphrase the backup
cannot be restored**, so it has to be kept somewhere other than the server it protects.

See [Backups](../operations/backups.md).

## Research use

AFCT was built for an NSF-funded study across five universities, which is why the activity log is
as careful as it is: it is research data as well as an audit trail. If your institution is
participating in that study, the arrangements for it are made separately, through your own IRB.
Running AFCT does not by itself send anything to anyone.
