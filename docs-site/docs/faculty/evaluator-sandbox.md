# Evaluator Sandbox

The **Evaluator Sandbox** runs a pair of files through the autograder on their own, without a course, an assignment or a student. Use it to check an answer file before you build a problem around it, or to reproduce what a student saw when they say a correct answer was marked wrong.

Faculty, TAs and administrators can reach it. Open a course, select **Problems**, then **Evaluator Sandbox**; administrators also have it in the **Administration** menu.

## Run a test

1. Choose the **Problem Type**. For a finite automaton or push-down automaton, set a state limit or leave it unlimited; for a finite automaton, turn on **Deterministic** if the answer must be deterministic. These are the same settings a problem carries, and they change what the evaluator checks.
2. Upload the **Answer File**, the solution the other file is checked against.
3. Upload the **Submission File**, the file to check.
4. Select **Run**.

Both files must be valid JFLAP XML matching the chosen type, the same rule the problem bank applies. Accepted extensions are `.txt`, `.fa`, `.pda`, `.cfg`, `.re` and `.jff`.

The test joins the same queue that grades real submissions, so it may wait a moment before it starts. The page reports what it is waiting for and updates itself; there is nothing to refresh.

## What you get back

- A verdict: **Correct**, **Not correct**, or **Did not run** when the evaluator could not produce one.
- The feedback the evaluator wrote, which is what a student would have seen.
- How long the run took.
- **Full evaluator output**, the complete result the evaluator returned.
- **Evaluator warnings**, anything the evaluator reported alongside the result.

You can run one test at a time. Select **Clear** to discard a result and start another.

## What is kept

Nothing is graded, and nothing about a test appears in a gradebook.

Both uploaded files are deleted as soon as the run finishes, and the result itself is removed within the hour. That is deliberate: the file you are testing is usually a student's own work, and a test must not become a second copy of it outside the submission system.
