import { describe, expect, it } from 'vitest';

import {
  discloseGradeFeedback,
  discloseSubmissionFeedback,
  feedbackVisibilityMap,
  showsFeedback,
} from './feedback-visibility';

const shown = feedbackVisibilityMap([{ problemId: 'p1', showFeedback: true }]);
const hidden = feedbackVisibilityMap([{ problemId: 'p1', showFeedback: false }]);

const attempt = (over: Partial<Parameters<typeof discloseSubmissionFeedback>[0]> = {}) => ({
  problemId: 'p1',
  status: 'COMPLETED',
  feedback: 'The string aab is accepted but should be rejected.',
  ...over,
});

const gradeRow = (over: Partial<Parameters<typeof discloseGradeFeedback>[0]> = {}) => ({
  problemId: 'p1',
  feedback: 'The string aab is accepted but should be rejected.',
  gradeSource: 'AUTOGRADER',
  ...over,
});

const asStudent = { isStaff: false };
const asStaff = { isStaff: true };

describe('showsFeedback', () => {
  it('treats a problem the map has never heard of as showing feedback', () => {
    // Defaulting the other way would withhold feedback because a query forgot a column, which
    // is a silent wrong answer rather than a loud one.
    expect(showsFeedback(hidden, 'some-other-problem')).toBe(true);
  });
});

describe('a submission, as a student reads it', () => {
  it('hands over the feedback when the problem shows it', () => {
    expect(discloseSubmissionFeedback(attempt(), shown, asStudent)).toEqual({
      feedback: 'The string aab is accepted but should be rejected.',
      feedbackVisible: true,
    });
  });

  it('withholds it when the problem does not, and says that it did', () => {
    // The flag is the whole point: without it the student reads an empty field as the evaluator
    // having had nothing to say.
    expect(discloseSubmissionFeedback(attempt(), hidden, asStudent)).toEqual({
      feedback: null,
      feedbackVisible: false,
    });
  });

  it('still explains a run that did not finish', () => {
    // The column holds the evaluator's feedback or the reason there is none. Hiding the second
    // turns a system failure into silence, and then into a support email.
    const failed = attempt({ status: 'FAILED', feedback: 'The file could not be parsed.' });

    expect(discloseSubmissionFeedback(failed, hidden, asStudent)).toEqual({
      feedback: 'The file could not be parsed.',
      feedbackVisible: true,
    });
  });

  it('reports an attempt still in the queue as visible, not withheld', () => {
    const pending = attempt({ status: 'PENDING', feedback: null });

    expect(discloseSubmissionFeedback(pending, hidden, asStudent)).toEqual({
      feedback: null,
      feedbackVisible: true,
    });
  });

  it('calls an empty result visible rather than withheld', () => {
    // "The evaluator said nothing" and "you are not being told" are different statements and
    // the payload has to keep them apart.
    expect(discloseSubmissionFeedback(attempt({ feedback: null }), shown, asStudent)).toEqual({
      feedback: null,
      feedbackVisible: true,
    });
  });
});

describe('a submission, as staff read it', () => {
  it('is never redacted, which is the promise the setting makes', () => {
    expect(discloseSubmissionFeedback(attempt(), hidden, asStaff)).toEqual({
      feedback: 'The string aab is accepted but should be rejected.',
      feedbackVisible: true,
    });
  });

  it('is not redacted on a failed run either', () => {
    const failed = attempt({ status: 'FAILED', feedback: 'The file could not be parsed.' });

    expect(discloseSubmissionFeedback(failed, hidden, asStaff).feedback).toBe(
      'The file could not be parsed.',
    );
  });
});

describe('a grade row, as a student reads it', () => {
  it('withholds the autograder copy when the problem hides feedback', () => {
    expect(discloseGradeFeedback(gradeRow(), hidden, asStudent)).toEqual({
      feedback: null,
      feedbackVisible: false,
    });
  });

  it('always shows what a person wrote by hand', () => {
    // A TA typing a comment to a student means it to arrive. The switch is about the evaluator's
    // witness string, not about silencing the staff.
    const byHand = gradeRow({ gradeSource: 'MANUAL', feedback: 'Check your transitions on b.' });

    expect(discloseGradeFeedback(byHand, hidden, asStudent)).toEqual({
      feedback: 'Check your transitions on b.',
      feedbackVisible: true,
    });
  });

  it('shows the autograder copy when the problem shows feedback', () => {
    expect(discloseGradeFeedback(gradeRow(), shown, asStudent).feedbackVisible).toBe(true);
  });
});
