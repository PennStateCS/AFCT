/**
 * Whether a student is allowed to read what the evaluator said about their attempt.
 *
 * A problem on an assignment carries `showFeedback`. Off, the student sees the verdict and not
 * the witness string. The feedback is still produced, still stored, and still read by staff:
 * this is a disclosure rule, not a grading rule.
 *
 * Pure and database-free, like `effective-deadline.ts` and `submission-limits.ts`: callers fetch
 * the rows and the settings, then pass them in. Every student-facing read path routes through
 * here rather than testing the flag itself, because there are six such paths and the failure
 * mode of getting one wrong is a promise the software does not keep.
 *
 * Three rules that "off means only correct and incorrect" does not capture on its own:
 *
 * 1. **A run that failed still explains itself.** The same column holds the evaluator's feedback
 *    or the reason it produced none, and withholding the second turns "your file could not be
 *    read" into silence. Only a COMPLETED attempt is redacted.
 * 2. **A person's comment is not the evaluator's.** On a grade row the text is sometimes the
 *    autograder's copy and sometimes something a TA typed; `gradeSource` tells them apart, and
 *    only `AUTOGRADER` is withheld. Someone writing to a student means it to arrive.
 * 3. **Withheld is not absent.** Every redacted payload carries `feedbackVisible: false`, so the
 *    web app and the desktop client can say the feedback is being withheld rather than render
 *    the "no feedback" they show for an evaluator that had nothing to say.
 */

/** How the problem is configured, keyed by problem id. Missing means the default, which is on. */
export type FeedbackVisibilityMap = ReadonlyMap<string, boolean>;

export function feedbackVisibilityMap(
  problems: ReadonlyArray<{ problemId: string; showFeedback: boolean }>,
): FeedbackVisibilityMap {
  return new Map(problems.map((p) => [p.problemId, p.showFeedback]));
}

/**
 * Whether feedback is shown for a problem.
 *
 * Absent from the map means shown. A problem this map does not know about is not evidence that
 * its feedback is hidden, and defaulting the other way would withhold feedback because of a
 * query that forgot to select a column.
 */
export function showsFeedback(map: FeedbackVisibilityMap, problemId: string): boolean {
  return map.get(problemId) ?? true;
}

/** The shape any student-facing submission payload has to have for this to decide. */
export type RedactableSubmission = {
  problemId: string;
  status: string;
  feedback: string | null;
};

/** What a payload gains: the text, and whether the reader is being shown it. */
export type FeedbackDisclosure = {
  feedback: string | null;
  /**
   * False only when there is feedback and this reader is not allowed it. True whenever the text
   * is shown, and true when there is none to show, since "the evaluator said nothing" is not the
   * same statement as "you are not being told".
   */
  feedbackVisible: boolean;
};

/**
 * One submission's feedback as this reader should receive it.
 *
 * `isStaff` short-circuits everything: the whole point is that the text stays available to the
 * people running the course.
 */
export function discloseSubmissionFeedback(
  submission: RedactableSubmission,
  map: FeedbackVisibilityMap,
  opts: { isStaff: boolean },
): FeedbackDisclosure {
  if (opts.isStaff) return { feedback: submission.feedback, feedbackVisible: true };
  if (showsFeedback(map, submission.problemId)) {
    return { feedback: submission.feedback, feedbackVisible: true };
  }
  // Rule 1: an attempt that did not finish is explaining itself, not giving feedback.
  if (submission.status !== 'COMPLETED') {
    return { feedback: submission.feedback, feedbackVisible: true };
  }
  return { feedback: null, feedbackVisible: false };
}

/** The shape any student-facing grade payload has to have. */
export type RedactableGrade = {
  problemId: string;
  feedback: string | null;
  gradeSource: string;
};

/**
 * One grade row's comment as this reader should receive it.
 *
 * Rule 2 lives here: the switch withholds the autograder's copy of the feedback and never a
 * comment a person wrote.
 */
export function discloseGradeFeedback(
  grade: RedactableGrade,
  map: FeedbackVisibilityMap,
  opts: { isStaff: boolean },
): FeedbackDisclosure {
  if (opts.isStaff) return { feedback: grade.feedback, feedbackVisible: true };
  if (showsFeedback(map, grade.problemId)) {
    return { feedback: grade.feedback, feedbackVisible: true };
  }
  if (grade.gradeSource !== 'AUTOGRADER') {
    return { feedback: grade.feedback, feedbackVisible: true };
  }
  return { feedback: null, feedbackVisible: false };
}

/** What a student reads where the feedback would have been. */
export const FEEDBACK_WITHHELD_MESSAGE = 'Feedback is not shown for this problem.';
