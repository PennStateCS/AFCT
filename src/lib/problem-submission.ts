export type ProblemSubmission = {
  id: string;
  submittedAt: string | Date;
  fileName?: string | null;
  originalFileName?: string | null;
  feedback?: string | null;
  grade?: number | null;
  status: string;
  correct?: boolean | null;
  problemId?: string | null;
  [key: string]: unknown;
};
