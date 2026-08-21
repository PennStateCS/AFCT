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
- **A student's own attempts are never paired with each other.**
- **No repeats.** A pair already matched by content or shape is not reported again as a near match.

## The provenance check

`findNearMatches` (`lib/similarity/near-matches.ts`) is a pure function over rows already loaded, so it is testable without a database.

1. Count how many **students** hold each feature, once each however many times they submitted.
2. Discard anything held by more than `FEATURE_COMMON_SHARE` of them (0.25), and anything only one student holds: it cannot be shared, so it is evidence about nobody, and being the rarest thing in the problem it would otherwise dominate the denominator in step 5 and penalise a submission for being distinctive.
3. Index the survivors; candidate pairs come only from sharing one, never from comparing everybody with everybody.
4. Reject a pair whose sizes differ by more than `MAX_SIZE_DIFFERENCE_SHARE` (0.4). Two versions of one file differ by a state or two; machines of very different sizes are two machines however much skeleton they share.
5. Score a pair by the summed rarity weight of its shared features, measured against the smaller of the two.
6. Report it when it clears both `MIN_SHARED_RARE_FEATURES` (4) and `MIN_SHARED_SHARE` (0.5).

Every attempt is compared, not one per student: a file can be copied on a fourth try as easily as a first. Two students still get one card between them, showing the attempts that match each other best.

The score exists to rank and to gate. It is never shown, never stored, and can be recomputed at any time. What a reader sees is the evidence list, and every line of it is a count the code can point at.

**The constants are judgement, not measurement.** They were chosen against fixtures, not against a real class, and they are the first thing to revisit once real submissions exist. They live together at the top of the file for that reason.

What seeded demo data already shows: with twenty students and machines of three to six states, a submission carries only a handful of features, so four shared uncommon ones is a low bar and the check reports pairs a professor would shrug at. Small machines and small cohorts are where it is chattiest. Resist tuning the numbers against invented data, which only fits them to whatever the generator happens to produce; tune them against a real assignment.

## Where false positives remain

- A small machine has few pieces, so a few coincidences can clear the bar. The rarity filter is the only thing holding that back.
- A cohort where the problem itself invites an odd construction will make that construction look rare when it is not.
- Fewer than roughly eight students on a problem means nothing can be rare enough to report at all. The check is quiet rather than wrong, but do not read its silence as a clean bill.

## The presentation layer

Everything the tab decides about *display* lives in `lib/similarity/evidence.ts`, as pure functions over what the API returns. Nothing there touches the detector.

- `matchTypeOf` maps a group to one of `exact`, `same-machine`, `structural` or `common`. Commonality is checked first: past the threshold it is convergence whatever the files look like.
- `STRENGTH_OF` maps that to the word shown on the card. It grades the artifact evidence, never the likelihood of misconduct, and `common` sits outside the scale rather than at the bottom of it.
- `clusterMatches` runs union-find over shared students, per problem, so four students who all share work are one card rather than six. Common groups are never folded into a cluster of findings. Relationships stay on the cluster and are rendered behind one control.
- `compareClusters` orders the page: match type first, then reuse after passing, then size, then recency.

The card and its parts are `SimilarityMatchCard`, `SimilarityEvidenceBadge`, `SimilarityInfoPopover`, `SimilarityTimeline` and `SimilarityFilters`. The popover copy is the feature's explanation of itself and is worth as much care as the code.

## Changing this safely

- The wording lives in `components/assignments/similarity-format.ts`, deliberately apart from the components. Implementation vocabulary (hash, fingerprint, sha256) must not reach the UI.
- `lib/similarity/rarity.ts` has no imports on purpose: the panel is a client component, and importing the rule from `matches.ts` drags the Postgres driver into the browser bundle.
- Feature extraction must stay cheap and must never throw into the submission path.
- Backfill existing rows with `scripts/backfill-content-hashes.mjs` after any change to how a hash or a feature is computed, or old and new rows will silently stop matching each other.
