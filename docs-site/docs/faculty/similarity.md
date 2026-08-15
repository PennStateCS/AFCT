# Similarity

The **Similarity** tab on an assignment lists submissions that are the same file as another student's. It is visible to course staff (faculty and TAs) and admins only, never to students.

## What it compares

When a file is submitted, AFCT records a fingerprint of its contents. Two submissions with the same fingerprint hold the same work: the same automaton, with the states in the same places, or the same grammar, or the same regular expression. Formatting that carries no meaning is ignored, so a file that has been through a different editor, or saved by a different version of JFLAP, still matches its original.

The fingerprint is taken on the server as the file arrives, so it covers submissions from the web app and from the AFCT client alike.

Comparison is per problem. A match is only ever between students answering the same question in your course, and never reaches into another course.

## How to read it

The tab opens with one line telling you whether there is anything to read at all, for example "1 set of identical work across 1 problem". Below it, matches are grouped under the problem they belong to, rarest first.

Each match card carries the count that gives it its meaning:

> **2 of 40 students submitted identical work** · 6 minutes apart

Identical work on its own proves nothing. A problem with one obvious answer will have students submitting the same thing honestly, and a grammar or a regular expression has no layout to differ in, so identical files are expected there. Two students out of forty is worth reading. Twenty-five out of forty is what a correct answer looks like, and AFCT marks those cards **Common**, says so in plain words, and sorts them last.

How far apart the two submissions arrived is shown beside the count. Six minutes apart and three weeks apart are very different situations, and you are the one who knows which matters here.

**Compare files** opens two of the submissions side by side, drawn the way that problem type is normally read: two automata, two grammars, two expressions. It opens on the two that were submitted closest together, and when a match involves more than two students each side can be switched to any of the others. Node positions are kept as the student left them, because where somebody placed their states is exactly what separates a copied file from the same answer worked out twice. Each student's file can also be downloaded from the card.

Teammates on a group assignment are not reported. Every member's submission writes its own record against the group's shared set, so a team holding the same file is the group feature working, not a finding.

## What it does not do

AFCT does not decide that anyone has cheated, does not label a student or a submission as suspicious, and stores no such flag. An academic integrity decision is yours, based on the files and on everything else you know about your course.

The check is also not a guarantee. It finds submissions that are the same file. A student who redraws an answer, renames the states, or moves a node produces a different fingerprint, and will not appear here.

Because the fingerprint is recorded as files arrive, submissions from before this feature existed have none. They will not appear in the tab until an administrator backfills them (see the `scripts/backfill-content-hashes.mjs` script in the repository).
