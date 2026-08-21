# Similarity

The **Similarity** tab on an assignment collects submissions that appear to share an origin, and shows you what they have in common so you can decide what it means. It is visible to course staff (faculty and TAs) and administrators only, never to students.

## What AFCT will and will not tell you

AFCT reports facts about files: these two are the same file, these two are the same machine drawn differently, these two share structure the rest of the class does not. It does not decide that anyone copied anything, does not label a student or a submission as suspicious, stores no such flag, and shows no similarity percentage.

That restraint is deliberate. Nothing in a submitted file can distinguish two students who shared work from two who reached the same answer honestly, and a number would invite you to treat a guess as a measurement. The evidence is yours to weigh against everything else you know about your course.

## What it compares

Every submission is described on the server as the file arrives, so this covers work sent from the web app and from the AFCT client alike, and nothing about it depends on the client behaving. Comparison always happens within a single problem: a match is only ever between students answering the same question in your course, and never reaches into another course.

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
| **Expected** | Common answer | Enough of the class submitted this that it reads as the answer |

The strength describes the files and nothing else. It is not a probability that anyone copied anything, and it is deliberately not a traffic light: a **Very strong** match on a two-state machine still needs your judgement, and a **Possible** one can matter a great deal alongside what you already know.

The **?** button on each card explains that card's match type in a sentence or two, along with the facts computed for this particular group. It is a real button, so it works from the keyboard and reads correctly with a screen reader.

### What is on a card

Under the strength and the match type is the count that gives the match its meaning, for example "2 of 38 students submitted the same saved machine". On a problem with no drawing it reads the same way about the saved grammar. Beside the count are the size of the work and how far apart in time the closest two submissions were.

**Read the count before anything else.** Identical work proves nothing on its own: a problem with one obvious answer will have students submitting the same thing honestly, and a grammar or a regular expression has no layout to differ in, so identical files are expected there. Two students out of thirty-eight is worth reading. Fourteen out of thirty-eight is what a correct answer looks like.

A **Structurally similar** card lists what the submissions actually share, and every line is something you can check against the files yourself:

> - 9 of 10 pieces of local structure are the same, 4 of them uncommon in this class
> - They differ by 1 transition
> - 3 pairs of states keep the same underlying identifiers, which are not the visible names
> - Both contain the same unusual feature: a state nothing reaches, a dead end, or a repeated transition

### Chronology

Each card lists its students earliest first, showing the time each submitted, which of their attempts it was, what the autograder made of it, a **First** marker on the earliest, and how long after the first each of the others arrived.

The order is half the story. "11 minutes apart" only means something once you know which way round.

### Filtering

The row of filters at the top narrows the page to one kind of match, each with its count: useful on a large assignment where you want to read every exact artifact first and come back to the rest. The filter changes what is shown and nothing else.

### Statuses

**Reused after passing.** The identical work had already been marked correct for another student when it was submitted again. That is the pattern a large course is most likely to miss: submit, watch the autograder award full marks, pass the file on. It appears as a badge beside the match type and is counted in the opening line, and it lifts a group above its equals rather than above stronger evidence. It remains a statement of what happened and in what order, not a conclusion.

**Matches the instructor reference solution.** The work is the problem's own answer file. Anyone holding that file has this work by definition, so the match says nothing on its own.

**Common answer.** Work shared by at least a quarter of a problem's students is treated as the expected answer, collected at the bottom of the page under **Common answers**, and collapsed. Nothing in that section is drawn until you open it. Not hidden, only set aside: less useful, not more serious.

### The common threshold

The **Common threshold** control at the top sets where that quarter falls. It is a starting point rather than a truth, since the right number depends on the problem and on how you teach the course: move it and watch the matches settle. The setting is yours alone, is remembered between visits, and changes only what is shown, never what is recorded.

### Comparing the files

**Compare submissions** opens two files side by side, drawn the way that problem type is normally read: two automata, two grammars, two expressions. Node positions are kept as the students left them, because where somebody placed their states is exactly what separates a copied file from the same answer worked out twice. Any notes a student wrote on the JFLAP canvas are drawn too, which is what lets you read the text behind a line about writing that matches word for word. When a group involves more than two students, either side can be switched to any of the others, and each relationship inside the group has its own **Compare** so you can go straight to the two files a given line is about.

Individual files can also be opened from the chronology. Opening or downloading a student's submission is recorded in the system log, as it is everywhere else in AFCT.

## What it will miss

A student who understands an answer and rebuilds it from scratch produces genuinely different work and will not appear here. That is as it should be: this finds shared files, not shared understanding.

The third check needs a class to compare against. On a problem with only a handful of submissions, nothing can be unusual yet, so it stays quiet early in an assignment's life and on very small cohorts.

Matching is per problem, and duplicating a course creates new problems, so work reused from a previous term is not found.

Submissions from before this feature existed carry no description and will not appear until an administrator backfills them, using the `scripts/backfill-content-hashes.mjs` script in the repository.
