// The worker side of staff evaluator trials: claim one, run the jar, record what it said.
//
// Runs inside the worker, next to submission grading, because that is the process with
// the jar and the network jail. Nothing here writes to a grade, and nothing here writes
// to the uploads volume: the worker mounts it read-only, so removing the trial's inputs
// is the app container's job (see `evaluator-trials.ts`).

import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getEvaluatorConfig, type EvaluatorConfig } from './eval-config';
import { runEvaluatorJar } from './evaluator-runner';
import { TRIALS_DIR, trialConcurrencyLimit } from './evaluator-trials';
import { resolveInsideDir } from './safe-upload';
import { errMessage } from './errors';

/**
 * Claim and run one waiting trial, if there is one and the ceiling allows it.
 * Returns true when a trial was run, so the caller knows the queue was not idle.
 *
 * Trials are claimed ahead of pending submissions: somebody is sitting in front of the
 * page waiting, where a submission is not being watched. The ceiling is what keeps that
 * priority from starving grading.
 */
export async function claimAndRunTrial(workerLoops: number): Promise<boolean> {
  // Looking for a waiting trial first keeps an idle pass to a single extra query: the
  // running count and the settings read only happen once there is something to run.
  const next = await prisma.evaluatorTrial.findFirst({
    where: { state: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!next) return false;

  const running = await prisma.evaluatorTrial.count({ where: { state: 'PROCESSING' } });
  if (running >= trialConcurrencyLimit(workerLoops)) return false;

  // The `state: 'PENDING'` guard in the WHERE is the entire claim, exactly as for a
  // submission: Postgres evaluates it under row lock, so of two workers racing the same
  // row only one matches.
  const claimed = await prisma.evaluatorTrial.updateMany({
    where: { id: next.id, state: 'PENDING' },
    data: { state: 'PROCESSING', startedAt: new Date() },
  });
  if (claimed.count === 0) return false;

  await runTrial(next.id, await getEvaluatorConfig());
  return true;
}

/** Record the outcome, unless the reaper already gave up on this trial (state fencing). */
async function finishTrial(id: string, data: Prisma.EvaluatorTrialUpdateManyMutationInput) {
  await prisma.evaluatorTrial.updateMany({
    where: { id, state: 'PROCESSING' },
    data: { ...data, completedAt: new Date() },
  });
}

async function runTrial(id: string, config: EvaluatorConfig): Promise<void> {
  try {
    const trial = await prisma.evaluatorTrial.findUnique({
      where: { id },
      select: {
        answerFileName: true,
        submissionFileName: true,
        problemType: true,
        maxStates: true,
        isDeterministic: true,
      },
    });

    if (!trial) {
      console.error(`[TrialRunner] Trial ${id} not found`);
      return;
    }

    if (!trial.answerFileName || !trial.submissionFileName) {
      await finishTrial(id, {
        state: 'FAILED',
        feedback: 'The uploaded files are no longer available. Upload them again.',
      });
      return;
    }

    const answerFilePath = resolveInsideDir(TRIALS_DIR, trial.answerFileName);
    const uploadedFilePath = resolveInsideDir(TRIALS_DIR, trial.submissionFileName);
    if (!fs.existsSync(answerFilePath) || !fs.existsSync(uploadedFilePath)) {
      await finishTrial(id, {
        state: 'FAILED',
        feedback: 'The uploaded files are no longer available. Upload them again.',
      });
      return;
    }

    const run = await runEvaluatorJar({
      answerFilePath,
      uploadedFilePath,
      config,
      problem: {
        type: trial.problemType,
        maxStates: trial.maxStates,
        isDeterministic: trial.isDeterministic,
      },
    });

    // stderr is kept whatever the outcome: on the trial page it is a diagnostic the
    // reader wants, which is the whole reason the page exists.
    const common = { stderr: run.stderr || null, durationMs: run.durationMs };

    if (run.outcome === 'ok') {
      await finishTrial(id, {
        ...common,
        state: 'COMPLETED',
        correct: run.correct ?? null,
        feedback: run.feedback,
        evaluationRaw: run.evaluation as Prisma.InputJsonValue,
      });
      return;
    }

    if (run.outcome === 'error') {
      await finishTrial(id, {
        ...common,
        state: 'FAILED',
        feedback: `The evaluator could not run: ${run.error}`,
      });
      return;
    }

    // Parsed to something that is not a result, or not JSON at all. Either way the raw
    // output is what the reader needs, so keep it rather than only the complaint.
    await finishTrial(id, {
      ...common,
      state: 'FAILED',
      feedback:
        run.outcome === 'invalid-json'
          ? 'The evaluator returned a result that could not be read.'
          : 'The evaluator did not return a result.',
      evaluationRaw: run.stdout || Prisma.JsonNull,
    });
  } catch (error) {
    console.error(`[TrialRunner] Error running trial ${id}:`, error);
    try {
      await finishTrial(id, {
        state: 'FAILED',
        feedback: `The evaluator could not run: ${errMessage(error)}`,
      });
    } catch {
      // The row will be picked up by the reaper if even this write fails.
    }
  }
}

/**
 * Fail trials left in PROCESSING by a worker that died. Unlike a submission these are
 * not returned to the queue: somebody is waiting on the answer, their uploads may
 * already have been swept, and a retry they cannot see is worse than a plain failure
 * they can act on.
 */
export async function reapStuckTrials(cutoff: Date): Promise<number> {
  const reaped = await prisma.evaluatorTrial.updateMany({
    where: { state: 'PROCESSING', startedAt: { lt: cutoff } },
    data: {
      state: 'FAILED',
      feedback: 'The evaluator stopped before it finished. Try again.',
      completedAt: new Date(),
    },
  });
  return reaped.count;
}
