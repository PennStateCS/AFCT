// Configuration for the submission evaluation queue / worker.
//
// Source of truth is the SystemSettings row (editable in the admin UI). When
// that's unavailable — no row yet, or the DB is unreachable (e.g. unit tests) —
// we fall back to the matching env var, then to the built-in default. Every
// value is clamped to a sane range before it leaves here.

import { prisma } from '@/lib/prisma';
import {
  DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS,
  DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB,
  DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS,
  DEFAULT_SUBMISSION_MAX_CONCURRENT,
  DEFAULT_SUBMISSION_MAX_ATTEMPTS,
  clampSubmissionEvalTimeoutMs,
  clampSubmissionEvalMaxMemoryMb,
  clampSubmissionResubmitCooldownMs,
  clampSubmissionMaxConcurrent,
  clampSubmissionMaxAttempts,
} from '@/lib/system-settings';

export type QueueSettings = {
  evalTimeoutMs: number;
  evalMaxMemoryMb: number;
  resubmitCooldownMs: number;
  maxConcurrent: number;
  maxAttempts: number;
};

export type EvaluatorConfig = {
  /** Max wall-clock time a single evaluation may run before it is killed (ms). */
  timeoutMs: number;
  /** Max JVM heap for the evaluator process (MB). */
  maxMemoryMb: number;
};

// Returns the env var as a number, or the fallback when it's unset/non-numeric.
const fromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export async function getQueueSettings(): Promise<QueueSettings> {
  let row: {
    submissionEvalTimeoutMs: number;
    submissionEvalMaxMemoryMb: number;
    submissionResubmitCooldownMs: number;
    submissionMaxConcurrent: number;
    submissionMaxAttempts: number;
  } | null = null;

  try {
    row = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: {
        submissionEvalTimeoutMs: true,
        submissionEvalMaxMemoryMb: true,
        submissionResubmitCooldownMs: true,
        submissionMaxConcurrent: true,
        submissionMaxAttempts: true,
      },
    });
  } catch {
    row = null; // DB unavailable — fall back to env/defaults below
  }

  return {
    evalTimeoutMs: clampSubmissionEvalTimeoutMs(
      row?.submissionEvalTimeoutMs ??
        fromEnv('SUBMISSION_EVAL_TIMEOUT_MS', DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS),
    ),
    evalMaxMemoryMb: clampSubmissionEvalMaxMemoryMb(
      row?.submissionEvalMaxMemoryMb ??
        fromEnv('SUBMISSION_EVAL_MAX_MEMORY_MB', DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB),
    ),
    resubmitCooldownMs: clampSubmissionResubmitCooldownMs(
      row?.submissionResubmitCooldownMs ??
        fromEnv('SUBMISSION_RESUBMIT_COOLDOWN_MS', DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS),
    ),
    maxConcurrent: clampSubmissionMaxConcurrent(
      row?.submissionMaxConcurrent ??
        fromEnv('SUBMISSION_MAX_CONCURRENT', DEFAULT_SUBMISSION_MAX_CONCURRENT),
    ),
    maxAttempts: clampSubmissionMaxAttempts(
      row?.submissionMaxAttempts ??
        fromEnv('SUBMISSION_MAX_ATTEMPTS', DEFAULT_SUBMISSION_MAX_ATTEMPTS),
    ),
  };
}

export async function getEvaluatorConfig(): Promise<EvaluatorConfig> {
  const s = await getQueueSettings();
  return { timeoutMs: s.evalTimeoutMs, maxMemoryMb: s.evalMaxMemoryMb };
}
