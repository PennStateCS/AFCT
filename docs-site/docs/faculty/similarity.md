# Similarity

The **Similarity** tab on an assignment collects submissions that appear to share an origin, and shows you what they have in common so you can decide what it means. It is visible to course staff (faculty and TAs) and administrators only, never to students.

## What AFCT will and will not tell you

AFCT reports facts about files: these two are the same file, these two are the same machine drawn differently, these two share structure the rest of the class does not. It does not decide that anyone copied anything, does not label a student or a submission as suspicious, stores no such flag, and shows no similarity percentage.

That restraint is deliberate. Nothing in a submitted file can distinguish two students who shared work from two who reached the same answer honestly, and a number would invite you to treat a guess as a measurement. The evidence is yours to weigh against everything else you know about your course.

## What it compares

Every submission is described on the server as the file arrives, so this covers work sent from the web app and from the AFCT client alike, and nothing about it depends on the client behaving. Comparison always happens within one assignment and one problem: a match is only ever between students answering the same question on the same assignment. A problem you reuse next term, or set for another section, is compared separately, and nothing ever reaches into another course.

There are three checks, from strictest to loosest.

**The same file.** Formatting that carries no meaning is set aside, so a file that went through a different editor, or was saved by a different version of JFLAP, still matches its original.

**The same work.** Where the states sit, what they are called, and the order things happen to be written in are all removed, leaving the machine itself. Two submissions matching here hold the same machine drawn differently, which is what a copied file looks like once somebody has dragged the states around or renamed them. A regular expression has no layout to remove, so it is compared on its contents alone.

**Uncommon structure in common.** The loosest check, for a copied file that has since been edited: a transition added, a state deleted, several states moved. It works from a description of each submission in small pieces, and reports two submissions that share the pieces the rest of the class does not. Anything most of the class has is discarded before any comparison, so what is left is the peculiar.

## Reading the tab

The tab opens with one line answering the only question worth asking at a glance:

> **2 match groups worth reviewing across 1 problem.**
> 1 contains an exact artifact match.
> 5 similarity relationships are contained in these groups.

Below it, groups are collected under the problem they belong to, strongest evidence first, with a heading giving the problem's title and how many students submitted it. The tab itself carries a count of the groups worth reviewing, so you can see there is something to read without opening it.

### Groups, not pairs

Four students who all share work produce six pairs, and six near-identical cards is a scrolling exercise rather than a review. Anything connected through a shared student is shown as one group, with one chronology and one summary, and the individual relationships stay available inside it under **Review the N relationships**. That keeps a large course readable: the number of cards follows the number of situations, not the square of the number of students.

### Evidence strength

Every card leads with how strong the file evidence is, as a word and an icon:

| Strength | Match type | What it means |
| --- | --- | --- |
| **Very strong** | Exact JFLAP artifact | Everyone in the group saved the same artifact, layout and all |
| **Strong** | Same machine | The same machine, with different state names or positions |
| **Possible** | Structurally similar | Not the same machine, but sharing structure the rest of the class does not |
| (none) | Instructor reference solution | The work is the solution you posted for the problem |
| (none) | Common answer | Enough of the class submitted this that it reads as the answer |

The last two carry no strength on purpose. Everybody holding the file you posted has the same artifact by definition, and enough of a class submitting the same right answer is what a right answer looks like, so neither is evidence about a student. Both are still shown, under **Set aside** at the foot of the page, and neither is counted on the tab's badge.

The strength describes the files and nothing else. It is not a probability that anyone copied anything, and it is deliberately not a traffic light: a **Very strong** match on a two-state machine still needs your judgement, and a **Possible** one can matter a great deal alongside what you already know.

The **?** button on each card explains that card's match type in a sentence or two, along with the facts computed for this particular group. It is a real button, so it works from the keyboard and reads correctly with a screen reader.

### What is on a card

Under the strength and the match type is the count that gives the match its meaning, for example "2 of 38 students submitted the same saved machine". On a problem with no drawing it reads the same way about the saved grammar. Beside the count are the size of the work and how far apart in time the closest two submissions were.

A group holding more than one relationship says something more careful: "3 of 38 students are connected by 2 similarity relationships", with the kinds listed underneath. That is deliberate. Students are gathered into one group by being connected to somebody in it, not by all sharing the same thing, so where you and I sent the same file and you and a third student only share structure, the group cannot say all three of us submitted the same machine. Open the relationships to see who shares what: each one names its participants with the attempt of theirs that matched, carries its own evidence badge, and states what those particular files have in common, so a sentence about byte-for-byte identical files always names the students or groups it is about.

**Read the count before anything else.** Identical work proves nothing on its own: a problem with one obvious answer will have students submitting the same thing honestly, and a grammar or a regular expression has no layout to differ in, so identical files are expected there. Two students out of thirty-eight is worth reading. Fourteen out of thirty-eight is what a correct answer looks like.

**"The files are byte-for-byte identical."** When it appears, this is the plainest statement the page can make: the submitted files are the same, byte for byte, with nothing set aside. Every other line allows for something incidental, whether that is formatting, state names, or where the states were dragged to. This one allows for nothing. When it covers only part of a group it names a number instead ("2 of them submitted byte-for-byte identical files"). It still is not a conclusion: on a grammar or an expression a correct answer really is one line of text, which is why the line is never shown on a **Common answer** card.

The line is absent for work submitted before AFCT started recording it, which reads as "not known" rather than "not identical". If a whole assignment is missing it, ask your administrator to run the fingerprint backfill.

A **Structurally similar** card lists what the submissions actually share, and every line is something you can check against the files yourself:

> - 9 of 10 pieces of local structure are the same, 4 of them uncommon in this class
> - They differ by 1 transition
> - 3 pairs of states keep the same underlying identifiers, which are not the visible names
> - Both contain the same unusual feature: a state nothing reaches, a dead end, or a repeated transition

### The attempts

Each card lists the attempts that actually matched, earliest first: who sent it, which attempt of theirs it was, when, what the autograder made of it, a **First** marker on the earliest, and how long after the first each of the others arrived. **Open** downloads that exact file.

One row per attempt, not per student. Where a problem allows several tries and two of somebody's attempts both matched, both are listed, because which attempt matched is the thing you are being asked about. Attempts that had nothing to do with the finding are not shown at all.

The order is half the story. "11 minutes apart" only means something once you know which way round.

### Group assignments

On an assignment submitted by groups, the group is who a finding is about: any member may submit for the team, so counting members would report two teams sharing work as four students. Cards count groups ("2 of 9 groups"), the attempt list leads with the group name, and the member who actually sent that attempt is named underneath as **Submitted by**. That is detail rather than ownership: the work belongs to the team.

Members of one team matching each other is the feature working, not a finding, so it is never reported. Everything else is counted in teams too: the common-answer threshold, and how unusual a piece of structure is. A team is one voice however many of its members submitted, so three people on one team all sending the shared file does not make that work look common. Work submitted before AFCT recorded groups is still counted by student, which is the only thing that can be said about it truthfully.

### Filtering

The row of filters at the top narrows the page to one kind of match, each with its count: useful on a large assignment where you want to read every exact artifact first and come back to the rest. The filter changes what is shown and nothing else, and **All** counts what it can show, so the number on it and the number of cards below always agree. Set-aside work is not in the filter row; it has its own section at the foot of the page.

### Statuses

**Reused after passing.** The same work had already been **marked correct** for another student when it was submitted again, timed from when that result landed rather than from when the earlier student submitted. Those are different moments: grading takes as long as it takes, and only the first one supports the sentence. Work graded before AFCT began recording result times makes no such claim, and a **Structurally similar** card never makes it at all, because those two submissions are not copies of each other. That is the pattern a large course is most likely to miss: submit, watch the autograder award full marks, pass the file on. It appears as a badge beside the match type and is counted in the opening line, and it lifts a group above its equals rather than above stronger evidence. It remains a statement of what happened and in what order, not a conclusion.

**Matches the instructor reference solution.** The work is the problem's own answer file. Anyone holding that file has this work by definition, so the match says nothing on its own, and a group that is entirely your posted solution is set aside rather than ranked as evidence. Where only part of a group is your solution, the card says how many of its relationships that covers instead of tagging everybody in it.

**Common answer.** Work shared by at least a quarter of a problem's students is treated as the expected answer, collected at the bottom of the page under **Set aside** with the reference-solution groups, and collapsed. Nothing in that section is drawn until you open it. Not hidden, only set aside: less useful, not more serious.

### The common threshold

The **Common threshold** control at the top sets where that quarter falls. It is a starting point rather than a truth, since the right number depends on the problem and on how you teach the course: move it and watch the matches settle. The setting is yours alone, is remembered between visits, and changes only what is shown, never what is recorded.

### Comparing the files

**Compare submissions** opens two files side by side, drawn the way that problem type is normally read: two automata, two grammars, two expressions. Node positions are kept as the students left them, because where somebody placed their states is exactly what separates a copied file from the same answer worked out twice. Any notes a student wrote on the JFLAP canvas are drawn too, which is what lets you read the text behind a line about writing that matches word for word. When a group involves more than two students, either side can be switched to any of the others, and each relationship inside the group has its own **Compare** so you can go straight to the two files a given line is about.

Individual files can also be opened from the attempt list. Opening or downloading a student's submission is recorded in the system log, as it is everywhere else in AFCT.

## What it will miss

A student who understands an answer and rebuilds it from scratch produces genuinely different work and will not appear here. That is as it should be: this finds shared files, not shared understanding.

The third check needs a class to compare against. On a problem with only a handful of submissions, nothing can be unusual yet, so it stays quiet early in an assignment's life and on very small cohorts.

Matching is per problem, and duplicating a course creates new problems, so work reused from a previous term is not found.

Submissions from before this feature existed carry no description and will not appear until an administrator backfills them, using the `scripts/backfill-content-hashes.mjs` script in the repository.
