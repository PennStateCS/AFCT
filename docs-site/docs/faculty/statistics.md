# Statistics

The **Statistics** tab gives you an at-a-glance read on how the class is doing on this assignment. It is visible to course staff (faculty and TAs) and admins only, never to students. An individual assignment is measured in students; a group assignment is measured in groups, and the tab says which.

Near the heading it shows the normal due date, how many participants are held to a different one, and who the figures are about: students who are **enrolled, whose account is active, and who were assigned this work**. Anybody else is named as a count with a reason, so this tab and the gradebook (which deliberately keeps showing dropped students) can be reconciled by reading rather than by counting. On a group assignment the same line reports groups with no active members left, and students who are in no group and therefore cannot submit at all.

Below that are several charts:

- **Assignment score distribution** - a histogram of final assignment percentages (total earned points over total possible), in 10-point ranges. Only fully graded work is included; the card notes how many were left out as incomplete or ungraded, and marks the mean and median.
- **Grading progress** - one bar per problem showing what is **Graded**, what needs a **Regrade** (a grade is recorded, but the participant submitted again after it was written), what is **Awaiting grading**, and where **Nothing was submitted**. On a problem you mark by hand this is your marking queue; on an autograded problem it settles as work arrives. The card says how many of the assignment's problems are hand-graded. A submission the evaluator could not process is reported here too, since it needs running again rather than waiting.
- **In the evaluation queue** - shown only while submissions are actually waiting on or running through the autograder, with the queue state of each participant's latest submission per problem. It is about the autograder's progress and not the class's: a hand-graded problem reads as evaluated the moment the file has been looked at, with nothing marked, which is why grading progress is a separate card.
- **Attempts to solve** - one bar per problem showing how many submissions participants needed before their first correct one (1 to 5+), plus a "not solved" segment, so you can see which problems take the most tries.
- **First-attempt success** - for each problem, the share of participants who got it right on their very first submission.
- **Submissions over time** - submissions per day, with the due date marked, so you can see how work clusters around the deadline.
- **Problem performance** - a box plot per problem on a shared 0-100% scale, showing the median, middle 50%, whiskers, and any outliers, so you can see which problems were hardest.
- **When submissions happen** - a day-of-week by hour heatmap of when submission attempts arrive (in course time), shaded from fewer to more so you can spot the busy hours.

Each chart has a matching data table for screen readers, and the figures update as more work is submitted and graded.

An evaluation that failed is never counted as an attempt the student got wrong: no verdict was produced, so **Attempts to solve** and **First-attempt success** skip it while the timeline and the heatmap still show that the submission happened.
