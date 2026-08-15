# Similarity

The **Similarity** tab on an assignment lists submissions that are the same file as another student's. It is visible to course staff (faculty and TAs) and admins only, never to students.

## What it compares

When a file is submitted, AFCT records two fingerprints of its contents.

The first is the file itself, with formatting that carries no meaning ignored, so a file that has been through a different editor, or saved by a different version of JFLAP, still matches its original. Two submissions sharing it are the same file.

The second is the same work with everything incidental removed: where the states sit on the canvas, what they are called, and the order things happen to be written in. Two submissions sharing it are the same machine drawn differently, which is what a copied file looks like once somebody has dragged the states around or renamed them. A regular expression has none of that, so it is matched on its contents alone.

The fingerprint is taken on the server as the file arrives, so it covers submissions from the web app and from the AFCT client alike.

Comparison is per problem. A match is only ever between students answering the same question in your course, and never reaches into another course.

## How to read it

The tab opens with one line answering the only question that matters at a glance: whether there is anything to review. For example, "1 match worth reviewing across 1 problem", followed where relevant by "1 includes work reused after another student received a correct result".

Below that, matches are grouped under the problem they belong to, with a heading giving the problem's title and how many students submitted it.

### A match card

Each card leads with what kind of match it is:

- **Identical file**, where every student in the match submitted the same file
- **Same work**, where some submitted the identical file and others the same work with cosmetic differences
- **Same work, drawn differently**, where the work is the same but state names or positions differ

Underneath is the count that gives it its meaning, for example "2 of 38 students submitted the identical file", and how far apart the closest two submissions were.

Identical work on its own proves nothing. A problem with one obvious answer will have students submitting the same thing honestly, and a grammar or a regular expression has no layout to differ in, so identical files are expected there. Two students out of thirty-eight is worth reading. Fourteen out of thirty-eight is what a correct answer looks like.

### Structurally similar

A card headed **Structurally similar** is the third check. It looks for two submissions that share unusual structure without being the same file or the same machine, which is what a copied file looks like once somebody has edited it: a transition added, a state deleted, several states moved.

It works from a description of each submission taken when the file arrives: what each state looks like from where it stands, the identifiers JFLAP keeps behind the visible names, where the states sit relative to each other, hand-adjusted transition curves, oddities such as a state nothing can reach, anything written on the drawing, and how a Turing machine is divided into blocks. Anything most of the class shares is discarded before any comparison, so what remains is the peculiar.

The card lists what the two actually share, and each line is something you can check against the files:

> - 9 of 10 pieces of local structure are the same, 4 of them uncommon in this class
> - They differ by 1 transition
> - 3 pairs of states keep the same underlying identifiers, which are not the visible names
> - Both contain the same unusual feature: a state nothing reaches, a dead end, or a repeated transition
> - Submitted 12 minutes apart

There is no similarity percentage, here or anywhere else on the page. A number would read as measurement, and this is evidence for you to weigh, not a measurement of anything.

Two things it will not do. It does not compare submissions the first two checks already matched, since that would say the same thing twice. And two students who independently build the same machine share its structure but not its peculiarities, so they should not appear here; if they do, the ratio and the evidence are what tell you so.

### Reused after passing

A match marked **Reused after passing** means the byte-identical file had already been marked correct for another student when it was submitted again. That is the pattern a large course is most likely to miss: submit, watch the autograder award full marks, pass the file on. These sort above everything else and are counted in the summary line.

It is still not a verdict. It says what happened and in what order, and leaves the conclusion to you.

### The instructor reference solution

A card noting that it "matches the instructor reference solution" is the problem's own answer file. Anyone holding that file has this work by definition, so the match says nothing on its own.

### Chronology

Each card lists its students earliest first, showing the time each submitted, which attempt of theirs it was, what the autograder made of it, a **First** marker on the earliest, and how long after the first each of the others arrived. The order and the elapsed times are the story: "11 minutes apart" only means something once you know which way round.

### Common matches

Work shared by at least a quarter of a problem's students is treated as the expected answer. Those matches are collected at the bottom of the page, collapsed, under **Common matches**. They are not hidden, only deprioritised: less useful, not more serious.

The **Common threshold** control at the top sets where that line falls. A quarter is a starting point rather than a truth, since the right number depends on the problem and on how you teach the course. The setting is yours alone, is remembered between visits, and changes only what is shown, never what is recorded.

### Comparing

**Compare submissions** opens two of the files side by side, drawn the way that problem type is normally read: two automata, two grammars, two expressions. Node positions are kept as the students left them, because where somebody placed their states is exactly what separates a copied file from the same answer worked out twice. When a match involves more than two students, either side can be switched to any of the others. Individual files can also be opened from the chronology.

The Similarity tab itself carries a count of the matches worth reviewing, so you can see there is something to read without opening it.

## What it does not do

AFCT does not decide that anyone has cheated, does not label a student or a submission as suspicious, and stores no such flag. An academic integrity decision is yours, based on the files and on everything else you know about your course.

The check is also not a guarantee. It finds work that is the same file, and work that is the same machine moved or renamed. A student who rebuilds an answer from scratch produces genuinely different work and will not appear here, which is as it should be: this finds shared files, not shared understanding.

Because the fingerprint is recorded as files arrive, submissions from before this feature existed have none. They will not appear in the tab until an administrator backfills them (see the `scripts/backfill-content-hashes.mjs` script in the repository).
