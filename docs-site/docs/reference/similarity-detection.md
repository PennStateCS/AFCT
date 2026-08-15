# Similarity detection

How the Similarity tab works underneath, for anyone changing it. The faculty-facing description is in [Similarity](../faculty/similarity.md), and the wording there is part of the feature: read it before changing anything a professor sees.

## The rule everything else serves

**Equality is not evidence. Rarity is.**

Students converge on correct answers. On an easy problem most of a class will submit byte-identical work honestly, and a grammar or regular expression has no layout to differ in, so identical files are the norm there rather than a finding. Every part of this subsystem exists to separate the unusual from the expected, and any change that reports a match without weighing how common it is will produce a page of noise that a professor will stop reading, which is worse than showing nothing.

The second rule follows from the first: **the system reports, the instructor decides**. No verdict is stored, no similarity percentage is shown, and the words "suspicious", "plagiarism", "cheating" and "copied" appear nowhere a user can see. Tests assert this; do not weaken them.

## The three checks

| Check | Answers | Where it is computed |
| --- | --- | --- |
| Content hash | Is this the same file? | `submissionContentHash`, `lib/similarity/content-hash.ts` |
| Shape hash | Is this the same work, drawn differently? | `submissionShapeHash`, same file |
| Provenance features | Does this share uncommon structure? | `extractProvenanceFeatures`, `lib/similarity/provenance.ts` |

All three are computed **when a file arrives**, in `lib/create-submission.ts`, which is the single choke point both the browser route and `/api/client/v1/submissions` pass through. None of them sits in the grading path: a failure to describe a file means it will not match anything, never that a submission fails.

The first two are also computed over a problem's reference solution when it is uploaded or replaced (`api/courses/[id]/problems/route.ts` and `[pid]/route.ts`), which is how a match can say it is simply the posted answer.

## What is stored

| Column | Holds |
| --- | --- |
| `Submission.contentHash` | sha256 of the normalised `<structure>` element |
| `Submission.shapeHash` | sha256 of the machine with layout, names and ordering removed |
| `Submission.provenanceFeatures` | A small versioned description; see below |
| `Problem.answerContentHash`, `Problem.answerShapeHash` | The same two hashes over the reference solution |

Indexed on `(problemId, contentHash)` and `(problemId, shapeHash)`. Nothing stores a score, and nothing stores a verdict.

`provenanceFeatures` is a JSON object carrying `version`, the machine type, state and transition counts, and a list of short prefixed strings. It is a description of the artifact, never a copy of it: about a kilobyte for a four-state machine. The prefixes are:

| Prefix | Feature |
| --- | --- |
| `f:` | Local structure, at two grains: what a state looks like from where it stands, and a coarser degree-only form that survives a label change |
| `t:` | Original state-id pairs. JFLAP's ids are not the visible names and survive renaming |
| `g:` | Layout as the step from each state to the one it points at, scaled by the median step |
| `c:` | Transition control points, placed relative to the states they join |
| `u:` | Oddities: unreachable states, dead ends, repeated transitions |
| `l:`, `n:` | State labels and sticky notes, compared exactly |
| `b:` | Turing-machine building blocks, their size, and the ids inside them |

`PROVENANCE_FEATURE_VERSION` gates comparison: a row extracted under a different version is skipped rather than compared under rules it was not written for. Bump it whenever the meaning of a feature changes, and backfill.

## Matching happens at read time

`findSubmissionMatches` (`lib/similarity/matches.ts`) runs when staff open the tab, not during grading. It groups on the shape hash within a problem, records which submissions inside a group are byte-identical, then runs the provenance check over the pairs the first two left behind.

Rules it applies, all of which have tests:

- **Scoped by problem.** A problem belongs to one course, so a match can never cross into another instructor's course. Do not widen this.
- **Group assignments.** A group whose submissions all belong to one student group is dropped: every member's submit writes its own row against the shared set, so a team matching itself is the group feature working.
- **A student's own resubmissions are not a match.**
- **No repeats.** A pair already matched by content or shape is not reported again as a near match.

## The provenance check

`findNearMatches` (`lib/similarity/near-matches.ts`) is a pure function over rows already loaded, so it is testable without a database.

1. One submission per student, their earliest.
2. Count how many students hold each feature.
3. Discard anything held by more than `FEATURE_COMMON_SHARE` of them (0.25).
4. Index the survivors; candidate pairs come only from sharing one, never from comparing everybody with everybody.
5. Score a pair by the summed rarity weight of its shared features, measured against the smaller of the two.
6. Report it when it clears both `MIN_SHARED_RARE_FEATURES` (4) and `MIN_SHARED_SHARE` (0.5).

The score exists to rank and to gate. It is never shown, never stored, and can be recomputed at any time. What a reader sees is the evidence list, and every line of it is a count the code can point at.

**The three constants are judgement, not measurement.** They were chosen against fixtures, not against a real class, and they are the first thing to revisit once real submissions exist. They live together at the top of the file for that reason.

## Where false positives remain

- A small machine has few pieces, so a few coincidences can clear the bar. The rarity filter is the only thing holding that back.
- A cohort where the problem itself invites an odd construction will make that construction look rare when it is not.
- Fewer than roughly eight students on a problem means nothing can be rare enough to report at all. The check is quiet rather than wrong, but do not read its silence as a clean bill.

## Changing this safely

- The wording lives in `components/assignments/similarity-format.ts`, deliberately apart from the components. Implementation vocabulary (hash, fingerprint, sha256) must not reach the UI.
- `lib/similarity/rarity.ts` has no imports on purpose: the panel is a client component, and importing the rule from `matches.ts` drags the Postgres driver into the browser bundle.
- Feature extraction must stay cheap and must never throw into the submission path.
- Backfill existing rows with `scripts/backfill-content-hashes.mjs` after any change to how a hash or a feature is computed, or old and new rows will silently stop matching each other.
