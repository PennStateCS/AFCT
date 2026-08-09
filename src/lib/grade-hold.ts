/**
 * Where a problem grade came from, and whether the autograder may still change it.
 *
 * Three independent facts decide this, and they are easy to collapse into each other:
 *
 *   - `autograderEnabled` is how the *problem* is set up.
 *   - `gradeSource` is who produced the *number*.
 *   - `gradedManually` is whether that number is *held* against automatic grading.
 *
 * The gradebook read the first and called it the second, so a grade a person had typed by
 * hand showed as "Autograded". Reading the third as the second is the same mistake one step
 * along: a grader who releases a grade they entered themselves has not made it the
 * autograder's work, and holding an autograded grade does not make it a person's. Every
 * surface that says anything about a grade's origin resolves it here.
 */

/** Who produced the number. Mirrors the `GradeSource` enum in the schema. */
export type GradeSource = 'AUTOGRADER' | 'MANUAL';

export type GradeHoldState =
  /** No grade recorded for this student on this problem. */
  | 'not-graded'
  /** The autograder produced it on a problem it grades. */
  | 'autograded'
  /** A person produced it on a problem the autograder also grades. */
  | 'manual-override'
  /** A person produced it on a problem the autograder does not grade. */
  | 'manually-graded';

export type GradeHoldInput = {
  /** Whether automatic grading is switched on for this problem. */
  autograderEnabled: boolean;
  /** Who produced the grade. */
  gradeSource: GradeSource;
  /** Whether the grade is held against automatic grading. */
  gradedManually: boolean;
  /** Whether a grade exists at all. */
  hasGrade: boolean;
};

/** The one control that changes the hold, named for what it does rather than for a mode. */
export type GradeHoldAction = {
  label: string;
  /** The value to send to the grade-hold endpoint. */
  hold: boolean;
  /**
   * Copy for a confirmation, or null when the action needs none. Only releasing asks: it
   * can change a student's mark on a later re-run with nobody entering a new grade, while
   * holding a grade cannot hurt anyone.
   */
  confirm: { title: string; description: string; confirmText: string } | null;
};

export type GradeHoldDescriptor = {
  state: GradeHoldState;
  /** Short label for a badge or a table cell. Says where the grade came from. */
  label: string;
  /** One sentence: where it came from, and what can still change it. */
  detail: string;
  /**
   * Whether the grade is currently protected from a re-run. Surfaces separately from the
   * label because it is a separate fact: a released manual grade has to look different from
   * a held one while still being credited to the person who set it.
   */
  held: boolean;
  /**
   * Whether this state is worth picking out in a list of grades. Only a hand-entered grade
   * on an autograded problem is: it is the one that says a person disagreed with the
   * autograder.
   */
  emphasis: boolean;
  action: GradeHoldAction | null;
};

const RELEASE: GradeHoldAction = {
  label: 'Release to autograder',
  hold: false,
  confirm: {
    title: 'Release this grade to the autograder?',
    description:
      'The grade stays as it is for now. The next time this submission is re-run, the autograder may replace it, without anyone entering a new grade.',
    confirmText: 'Release to autograder',
  },
};

const HOLD: GradeHoldAction = {
  label: 'Lock this grade',
  hold: true,
  confirm: null,
};

/**
 * Resolve the three facts into everything a surface needs: the label, the sentence, whether
 * the grade is protected, and the action that changes that.
 *
 * The action is offered only where automatic grading is on. Everywhere else there is nothing
 * on the other side of the control: a re-run on a hand-graded problem produces feedback and
 * never writes a grade, so a lock button there would guard against something that cannot
 * happen.
 */
export function describeGradeHold({
  autograderEnabled,
  gradeSource,
  gradedManually,
  hasGrade,
}: GradeHoldInput): GradeHoldDescriptor {
  if (!hasGrade) {
    return {
      state: 'not-graded',
      label: 'Not graded',
      detail: 'No grade has been recorded for this problem yet.',
      held: false,
      emphasis: false,
      action: null,
    };
  }

  const byPerson = gradeSource === 'MANUAL';

  if (!autograderEnabled) {
    // Nothing here can overwrite the grade, so the hold is not worth acting on either way.
    // Automatic grading can also be switched off after a problem has been graded, which
    // leaves an autograder-written grade on a problem that is now hand-graded; say where
    // the number came from rather than pretending a person entered it.
    return byPerson
      ? {
          state: 'manually-graded',
          label: 'Manually graded',
          detail:
            'A person set this grade. This problem is not automatically graded, so a re-run gives feedback without changing it.',
          held: gradedManually,
          emphasis: false,
          action: null,
        }
      : {
          state: 'autograded',
          label: 'Autograded',
          detail:
            'The autograder set this grade before automatic grading was switched off for this problem. A re-run now gives feedback without changing it.',
          held: gradedManually,
          emphasis: false,
          action: null,
        };
  }

  if (byPerson) {
    return {
      state: 'manual-override',
      label: 'Manual override',
      detail: gradedManually
        ? 'A person set this grade, so the autograder will not change it.'
        : 'A person set this grade, but it is not held, so re-running the autograder can replace it.',
      held: gradedManually,
      emphasis: true,
      action: gradedManually ? RELEASE : HOLD,
    };
  }

  return {
    state: 'autograded',
    label: 'Autograded',
    detail: gradedManually
      ? 'The autograder set this grade, and it is held, so a re-run will not change it.'
      : 'The autograder set this grade, so re-running it can change the grade.',
    held: gradedManually,
    emphasis: false,
    action: gradedManually ? RELEASE : HOLD,
  };
}
