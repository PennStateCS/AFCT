# Similarity

The **Similarity** tab on an assignment lists submissions that are the same file as another student's. It is visible to course staff (faculty and TAs) and admins only, never to students.

## What it compares

When a file is submitted, AFCT records a fingerprint of its contents. Two submissions with the same fingerprint hold the same work: the same automaton, with the states in the same places, or the same grammar, or the same regular expression. Formatting that carries no meaning is ignored, so a file that has been through a different editor, or saved by a different version of JFLAP, still matches its original.

The fingerprint is taken on the server as the file arrives, so it covers submissions from the web app and from the AFCT client alike.

Comparison is per problem. A match is only ever between students answering the same question in your course, and never reaches into another course.

## How to read it

Each row is a set of submissions holding identical work, with the students involved and a count that is the important part:

> **2 of 40 students**

Identical work on its own proves nothing. A problem with one obvious answer will have students submitting the same thing honestly, and a grammar or a regular expression has no layout to differ in, so identical files are expected there. Two students out of forty is worth reading. Twenty-five out of forty is what a correct answer looks like, and AFCT marks those rows **Common** and sorts them to the bottom.

Rows are ordered rarest first, so what is worth your attention is at the top.

Open **Manage → View these submissions** to see everyone in the match, when each was submitted, and to open or download the files themselves.

## What it does not do

AFCT does not decide that anyone has cheated, does not label a student or a submission as suspicious, and stores no such flag. An academic integrity decision is yours, based on the files and on everything else you know about your course.

The check is also not a guarantee. It finds submissions that are the same file. A student who redraws an answer, renames the states, or moves a node produces a different fingerprint, and will not appear here.

Because the fingerprint is recorded as files arrive, submissions from before this feature existed have none. They will not appear in the tab until an administrator backfills them (see the `scripts/backfill-content-hashes.mjs` script in the repository).
