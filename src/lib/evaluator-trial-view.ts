// The shape of an evaluator trial as the page sees it, in one place so the create and
// status routes cannot drift apart.
//
// Note what is missing: the stored file names. Those are internal to the uploads volume
// and are no use to a reader, who wants the names they picked the files by.

import type { EvaluatorTrial } from '@prisma/client';

export type EvaluatorTrialView = {
  id: string;
  state: EvaluatorTrial['state'];
  problemType: EvaluatorTrial['problemType'];
  maxStates: number | null;
  isDeterministic: boolean | null;
  /** The names the uploader chose, kept for display after the files are deleted. */
  answerFile: string;
  submissionFile: string;
  correct: boolean | null;
  feedback: string | null;
  evaluationRaw: unknown;
  stderr: string | null;
  durationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
};

/** True once the run is over, either way. */
export function isTrialFinished(state: EvaluatorTrial['state']): boolean {
  return state === 'COMPLETED' || state === 'FAILED';
}

export function serializeTrial(trial: EvaluatorTrial): EvaluatorTrialView {
  return {
    id: trial.id,
    state: trial.state,
    problemType: trial.problemType,
    maxStates: trial.maxStates,
    isDeterministic: trial.isDeterministic,
    answerFile: trial.answerOriginalName,
    submissionFile: trial.submissionOriginalName,
    correct: trial.correct,
    feedback: trial.feedback,
    evaluationRaw: trial.evaluationRaw ?? null,
    stderr: trial.stderr,
    durationMs: trial.durationMs,
    createdAt: trial.createdAt.toISOString(),
    startedAt: trial.startedAt?.toISOString() ?? null,
    completedAt: trial.completedAt?.toISOString() ?? null,
    expiresAt: trial.expiresAt.toISOString(),
  };
}
