export type ProblemSubmission = {
  id: string;
  submittedAt: string | Date;
  fileName?: string | null;
  originalFileName?: string | null;
  feedback?: string | null;
  /**
   * False when the problem withholds the evaluator's feedback from students. Absent or true
   * means the text above is all there is, which is not the same statement.
   */
  feedbackVisible?: boolean;
  grade?: number | null;
  status: string;
  correct?: boolean | null;
  problemId?: string | null;
  [key: string]: unknown;
};
