import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import type { SubmissionStatus } from '@prisma/client';

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { randomUUID } from 'crypto';

import { runEvaluatorJar } from './evaluator-runner';
import { claimAndRunTrial, reapStuckTrials } from './trial-runner';
import { getEvaluatorConfig, getQueueSettings, type EvaluatorConfig } from './eval-config';
import { createEnhancedActivityLog, type LogSeverity } from './activity-log-utils';
import { errMessage } from './errors';
import {
  DEFAULT_SUBMISSION_MAX_CONCURRENT,
  DEFAULT_SUBMISSION_MAX_ATTEMPTS,
} from './system-settings';

// The activity logger accepts either a Request or an explicit {ipAddress, userAgent}
// context. The worker has no HTTP request behind it, so it logs a "system" origin
// rather than letting the IP fall through to the literal "unknown" (which reads like a
// failed capture). These are server-originated autograder events, not client actions.
const WORKER_CONTEXT = { ipAddress: 'system', userAgent: 'submission-worker' } as const;

// The submission shape the evaluator works with: the scalar row plus the
// assignment problem's metadata. Declared once so the worker functions share
// the exact type (and the same DB include).
const submissionEvalInclude = {
  assignmentProblem: {
    select: {
      problem: {
        select: {
          fileName: true,
          type: true,
          maxStates: true,
          isDeterministic: true,
        },
      },
      assignmentId: true,
      problemId: true,
      maxPoints: true,
      autograderEnabled: true,
    },
  },
} satisfies Prisma.SubmissionInclude;

type WorkerSubmission = Prisma.SubmissionGetPayload<{ include: typeof submissionEvalInclude }>;

// Singleton guard for the worker pool. Backed by the process global, NOT a plain
// module-level `let`: under `next dev` HMR the module is re-evaluated on every recompile,
// which resets a module `let` to false and let startSubmissionWorker() spawn a *fresh*
// worker pool each time. Stacked pools then exhaust the DB connection pool (polls wait
// seconds for a connection) and starve the dev server. The process global persists across
// re-evaluation, so the guard actually holds. Production (single start) is unaffected.
const workerFlags = globalThis as unknown as { __submissionWorkerStarted?: boolean };

// Concurrency is the number of live worker loops (each handles one submission at
// a time). desiredWorkers and maxAttempts are refreshed from SystemSettings, so
// an admin can retune the queue without a restart; see refreshQueueSettings().
let loopCount = 0;
let desiredWorkers = DEFAULT_SUBMISSION_MAX_CONCURRENT;
let maxAttempts = DEFAULT_SUBMISSION_MAX_ATTEMPTS;

const SETTINGS_REFRESH_MS = 30_000; // how often to re-read the queue settings
const REAP_INTERVAL_MS = 60_000; // how often to scan for stuck PROCESSING rows
const STUCK_GRACE_MS = 60_000; // grace beyond the eval timeout before a row is "stuck"

// How long a worker loop waits before checking the queue again, by outcome.
const LOOP_DELAY_MS = {
  NEXT: 100, // just finished (or lost a claim); the queue may still be full
  ERROR: 5_000, // a loop error; back off longer
};

// Idle backoff. Every loop that finds an empty queue costs two queries, so a fixed
// 3s poll across the default five loops was ~200 queries/minute with nothing to do,
// around the clock. The wait now grows the longer the queue has been empty.
//
// Keyed on how long we have been idle rather than on a count of empty passes,
// because the loop count is admin-configurable (1-20): a counter shared by twenty
// loops would reach the longest wait twenty times faster than one shared by one.
//
// The cost is latency on the first submission after a quiet spell, up to the longest
// wait here. That is a deliberate trade: the reaper already runs on a 60s cycle, so
// this is not the slowest thing in the queue's recovery path.
const IDLE_BACKOFF_MS = [
  { idleFor: 300_000, wait: 30_000 }, // quiet for 5min+: check twice a minute
  { idleFor: 60_000, wait: 10_000 }, // quiet for 1min+: ease off
  { idleFor: 0, wait: 3_000 }, // just went quiet; work may still be arriving
];

// When the queue last had something in it. Shared by every loop so one loop finding
// work speeds all of them back up, which is what should happen when a burst starts.
let lastWorkAt = Date.now();

function idleDelayMs(): number {
  const idleFor = Date.now() - lastWorkAt;
  // Ordered longest-idle first, and the last entry is `idleFor: 0`, so this always
  // matches.
  return IDLE_BACKOFF_MS.find((step) => idleFor >= step.idleFor)!.wait;
}

type SubmissionEvaluationStatus = keyof typeof SubmissionStatus;

interface SubmissionEvaluationResult {
  feedback: string | null;
  correct?: boolean;
  evaluationRaw: unknown | null;
  status: SubmissionEvaluationStatus;
}

async function logSubmissionActivity(
  submission: Pick<
    WorkerSubmission,
    'id' | 'studentId' | 'courseId' | 'assignmentId' | 'problemId'
  >,
  action: string,
  severity: LogSeverity,
  // Nested values are allowed: SUBMISSION_EVALUATION_SUCCESS records the evaluator's
  // whole JSON verdict, which is research data and must go in unflattened.
  metadata: Record<string, unknown>,
) {
  // Write straight to the DB; we're in the same process, so there's no reason
  // to go back out over HTTP. Only scalar ids are pulled off the submission;
  // never the full student record.
  try {
    await createEnhancedActivityLog(prisma, WORKER_CONTEXT, {
      userId: submission.studentId ?? null,
      action,
      severity,
      category: 'SUBMISSION',
      courseId: submission.courseId ?? null,
      assignmentId: submission.assignmentId ?? null,
      problemId: submission.problemId ?? null,
      submissionId: submission.id ?? null,
      metadata: {
        submissionId: submission.id,
        ...metadata,
      },
    });
  } catch (error) {
    console.error('[SubmissionWorker] Failed to write activity log:', error);
  }
}

// Queue-level events that aren't tied to a single submission (loop/reaper errors,
// crash recovery). Categorized as SYSTEM.
async function logQueueEvent(
  action: string,
  severity: LogSeverity,
  metadata: Record<string, string | number | boolean | null>,
) {
  try {
    await createEnhancedActivityLog(prisma, WORKER_CONTEXT, {
      userId: null,
      action,
      severity,
      category: 'SYSTEM',
      metadata,
    });
  } catch (error) {
    console.error('[SubmissionWorker] Failed to write queue log:', error);
  }
}

export function startSubmissionWorker() {
  // Worker already started (guard survives dev HMR via the process global).
  if (workerFlags.__submissionWorkerStarted) {
    console.error('[SubmissionWorker] Already started');
    return;
  }
  workerFlags.__submissionWorkerStarted = true;

  // Spawn the initial pool from the defaults, then refresh from settings (which
  // adjusts the pool and reschedules itself).
  ensureWorkers();
  void refreshQueueSettings();

  // Start the reaper that recovers submissions left PROCESSING by a crash/restart
  void reapStuckSubmissions();

  console.log('[SubmissionWorker] Started safely');
}

// Spawn loops until we're running `desiredWorkers` of them. Scaling down is
// handled by each loop retiring itself (see runWorkerLoop).
function ensureWorkers() {
  while (loopCount < desiredWorkers) {
    loopCount++;
    void runWorkerLoop();
  }
}

// Re-schedule a self-managing async task (each handles its own errors internally),
// marking the promise as intentionally not awaited so setTimeout's void-return
// contract is honored.
function scheduleAsync(task: () => Promise<void>, ms: number): void {
  setTimeout(() => void task(), ms);
}

// Periodically pull the queue settings so concurrency / attempt limits can be
// changed at runtime. On any error we keep the last known values.
async function refreshQueueSettings() {
  try {
    const settings = await getQueueSettings();
    desiredWorkers = settings.maxConcurrent;
    maxAttempts = settings.maxAttempts;
    ensureWorkers(); // scale up if the limit was raised
  } catch (error) {
    console.error('[SubmissionWorker] Settings refresh error:', error);
  } finally {
    scheduleAsync(refreshQueueSettings, SETTINGS_REFRESH_MS);
  }
}

// Recover submissions stuck in PROCESSING (e.g. the server died mid-evaluation)
// by returning them to PENDING so another worker can pick them up. The attempts
// counter is already incremented at claim time, so a repeatedly-stuck submission
// is eventually failed by the poison-pill guard in runWorkerLoop.
async function reapStuckSubmissions() {
  try {
    const { timeoutMs } = await getEvaluatorConfig();
    const cutoff = new Date(Date.now() - (timeoutMs + STUCK_GRACE_MS));

    const reaped = await prisma.submission.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      // The token goes with the status: whoever held this row has lost it, and clearing the
      // token is what stops them writing to it if they ever come back.
      data: { status: 'PENDING', processingToken: null },
    });

    if (reaped.count > 0) {
      // The reaper puts work back on the queue, so the loops should stop backing off.
      // Without this they would keep the long wait, having seen nothing themselves.
      lastWorkAt = Date.now();
      console.warn(`[SubmissionWorker] Reaped ${reaped.count} stuck submission(s) back to PENDING`);
      // Stuck PROCESSING rows almost always mean the server died mid-evaluation.
      await logQueueEvent('SUBMISSION_QUEUE_REAPED', 'WARNING', { count: reaped.count });
    }

    // Staff trials get stuck the same way, and are failed rather than retried.
    const reapedTrials = await reapStuckTrials(cutoff);
    if (reapedTrials > 0) {
      console.warn(`[SubmissionWorker] Failed ${reapedTrials} stuck evaluator trial(s)`);
      // One entry for the sweep rather than one per row: this is the queue recovering,
      // and the trials themselves record nothing after the fact.
      await logQueueEvent('EVALUATOR_TRIAL_QUEUE_REAPED', 'WARNING', { count: reapedTrials });
    }
  } catch (error) {
    console.error('[SubmissionWorker] Reaper error:', error);
    await logQueueEvent('SUBMISSION_QUEUE_REAPER_ERROR', 'ERROR', {
      error: errMessage(error),
    });
  } finally {
    scheduleAsync(reapStuckSubmissions, REAP_INTERVAL_MS);
  }
}

/**
 * Claim a submission for this worker. Returns the ownership token, or null if someone else
 * already has it.
 *
 * The `status: 'PENDING'` guard in the WHERE is the entire claim: Postgres evaluates it
 * under row lock, so of two workers racing the same row exactly one sees PENDING and
 * updates it, and the loser matches zero rows. There is no SELECT-then-UPDATE window to
 * lose. The token written in the same statement is what every later write is fenced on.
 *
 * A random value rather than a counter, and that is the whole point. `attempts` used to serve
 * and could not: a rerun set it back to 0, the next claim took it to 1 again, and a worker
 * still evaluating the previous attempt matched that value and overwrote the newer result. A
 * token that is fresh on every claim can never come back round.
 *
 * Exported so the exclusivity can be tested against a real database - the guarantee is
 * a property of Postgres, and a mocked updateMany would assert nothing.
 */
export async function claimSubmission(id: string): Promise<string | null> {
  const token = randomUUID();
  const claimed = await prisma.submission.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, processingToken: token },
  });
  return claimed.count > 0 ? token : null;
}

/**
 * A post-claim write, fenced on the token the row carried when we claimed it.
 *
 * If the row was reaped, rerun or re-claimed by another worker while we were evaluating, it
 * holds a different token (or none), so our stale write matches nothing instead of clobbering
 * the new owner's result. Returns false when that happens.
 *
 * `token === null` means we never learned one (we failed before the claim), so there is nothing
 * to be stale relative to and the write is refused rather than let through unfenced: a worker
 * with no claim has no business writing to the row at all.
 */
export async function writeIfStillOwned(
  id: string,
  token: string | null,
  data: Prisma.SubmissionUpdateManyMutationInput,
): Promise<boolean> {
  if (token === null) return false;
  const written = await prisma.submission.updateMany({
    where: { id, processingToken: token },
    data,
  });
  return written.count > 0;
}

async function runWorkerLoop() {
  // Scale down: if concurrency was lowered, retire this loop.
  if (loopCount > desiredWorkers) {
    loopCount--;
    return;
  }

  try {
    // Staff evaluator trials come first: somebody is watching that page, and the
    // ceiling inside claimAndRunTrial is what stops them crowding out grading.
    if (await claimAndRunTrial(desiredWorkers)) {
      lastWorkAt = Date.now();
      scheduleAsync(runWorkerLoop, LOOP_DELAY_MS.NEXT);
      return;
    }

    // Fairness: a student who already has a submission being processed is skipped
    // so one student cannot occupy multiple worker slots at once.
    const inFlight = await prisma.submission.findMany({
      where: { status: 'PROCESSING' },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    const busyStudentIds = inFlight.map((s) => s.studentId);

    // Priority: nearest deadline first, then FIFO.
    const nextSubmission = await prisma.submission.findFirst({
      where: {
        status: 'PENDING',
        // Only add the filter when we have ids; an empty notIn is a Prisma footgun.
        ...(busyStudentIds.length ? { studentId: { notIn: busyStudentIds } } : {}),
      },
      orderBy: [{ assignmentProblem: { assignment: { dueDate: 'asc' } } }, { submittedAt: 'asc' }],
      select: { id: true, attempts: true },
    });

    // No work to be done
    if (nextSubmission === null) {
      scheduleAsync(runWorkerLoop, idleDelayMs());
      return;
    }

    // The queue is not empty, so drop every loop back to the shortest wait. This is
    // set on finding a row rather than on winning the claim: losing the race still
    // means there is work about, and that loop should come back promptly.
    lastWorkAt = Date.now();

    // Poison-pill guard: a submission that has been claimed too many times keeps
    // failing (or keeps getting reaped); fail it rather than retry forever.
    if (nextSubmission.attempts >= maxAttempts) {
      const failed = await prisma.submission.updateMany({
        where: { id: nextSubmission.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          feedback: 'Autograder gave up after too many failed attempts.',
        },
      });
      // A student's submission can no longer be graded; surface it for staff.
      if (failed.count > 0) {
        const info = await prisma.submission.findUnique({
          where: { id: nextSubmission.id },
          select: {
            id: true,
            studentId: true,
            courseId: true,
            assignmentId: true,
            problemId: true,
          },
        });
        if (info) {
          await logSubmissionActivity(info, 'SUBMISSION_FAILED_PERMANENTLY', 'ERROR', {
            attempts: nextSubmission.attempts,
            reason: 'exceeded max attempts',
          });
        }
      }
      scheduleAsync(runWorkerLoop, LOOP_DELAY_MS.NEXT);
      return;
    }

    // null means another loop/instance beat us to it. Move on.
    const token = await claimSubmission(nextSubmission.id);
    if (!token) {
      scheduleAsync(runWorkerLoop, LOOP_DELAY_MS.NEXT);
      return;
    }

    // Hold this loop until the evaluation finishes: one loop, one submission,
    // so the live loop count is the real concurrency limit.
    await evaluateSubmission(nextSubmission.id, token);

    // Move to next check
    scheduleAsync(runWorkerLoop, LOOP_DELAY_MS.NEXT);
    return;
  } catch (error) {
    console.error('[SubmissionWorker] Database or loop error:', error);
    await logQueueEvent('SUBMISSION_QUEUE_ERROR', 'ERROR', {
      error: errMessage(error),
    });
    scheduleAsync(runWorkerLoop, LOOP_DELAY_MS.ERROR);
    return;
  }
}

/**
 * Evaluate a submission this worker has claimed.
 *
 * `token` is the claim: every write below is conditioned on the row still carrying it. If the
 * submission is rerun, reaped or re-claimed while the evaluator runs, the row holds a different
 * token and these writes match nothing rather than overwriting whoever owns it now.
 */
async function evaluateSubmission(id: string, token: string | null = null) {
  let submission: WorkerSubmission | null = null;

  try {
    submission = await prisma.submission.findUnique({
      where: { id },
      // Intentionally no `student: true`; the worker only needs the scalar
      // studentId (already on the row), and including the User pulls its
      // password hash into memory and into logs.
      include: submissionEvalInclude,
    });

    if (!submission) {
      console.error(`[SubmissionWorker] Submission ${id} not found`);
      return;
    }

    // Run Java evaluator with the configured resource limits
    const evalConfig = await getEvaluatorConfig();
    const evaluation = await runJavaEvaluator(submission, evalConfig);

    const written = await writeIfStillOwned(id, token, {
      feedback: evaluation.feedback,
      correct: evaluation.correct,
      evaluationRaw:
        evaluation.evaluationRaw === null
          ? Prisma.JsonNull
          : (evaluation.evaluationRaw as Prisma.InputJsonValue),
      status: evaluation.status,
      // The claim ends with the result. Cleared in the same statement it is fenced on, so
      // there is no moment where the row is finished and still looks owned.
      processingToken: null,
    });

    if (!written) {
      // The row was reran/reaped and re-claimed by another worker while we
      // evaluated; discard our stale result rather than overwrite theirs.
      console.warn(
        `[SubmissionWorker] Submission ${id} was reclaimed during evaluation; discarding stale result.`,
      );
      return;
    }

    // Autograde submission if enabled
    if (submission.assignmentProblem.autograderEnabled === true) {
      const earnedPoints = evaluation.correct ? submission.assignmentProblem.maxPoints : 0;

      // A group submission's grade fans out to every current group member (each gets a
      // per-student row, defaulting to the group's grade); an individual submission grades
      // only the submitter. Never overwrite a manually-entered grade: update only
      // non-manual rows, and create rows only where none exists (skipDuplicates no-ops on
      // any manual row a TA set). Together this makes autograde skip any hand-set grade.
      const gradeAssignmentId = submission.assignmentId;
      const gradeProblemId = submission.problemId;
      const gradeTargetIds = submission.studentGroupId
        ? (
            await prisma.groupMembership.findMany({
              where: { groupId: submission.studentGroupId },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : [submission.studentId];

      // Where the grade came from, matching what manual group grading records. Without it a
      // member later changed by hand looks the same as one the group was never graded
      // together on, so the "adjusted from" marker never appears for autograded groups.
      const groupProvenance = submission.studentGroupId
        ? { groupGradeGroupId: submission.studentGroupId, groupGradeValue: earnedPoints }
        : {};

      // One transaction: a group is graded together or not at all. As two statements a
      // failure between them left a group half-graded with nothing recording which half.
      await prisma.$transaction(async (tx) => {
        await tx.assignmentProblemGrade.updateMany({
          where: {
            assignmentId: gradeAssignmentId,
            problemId: gradeProblemId,
            studentId: { in: gradeTargetIds },
            gradedManually: false,
          },
          // Stamping the source here matters for released grades: a grade a person entered
          // and then handed back becomes the autograder's the moment it overwrites it, and
          // saying otherwise would credit a person with a number they did not choose.
          data: {
            grade: earnedPoints,
            feedback: evaluation.feedback,
            gradeSource: 'AUTOGRADER',
            ...groupProvenance,
          },
        });
        await tx.assignmentProblemGrade.createMany({
          data: gradeTargetIds.map((studentId) => ({
            assignmentId: gradeAssignmentId,
            problemId: gradeProblemId,
            studentId,
            grade: earnedPoints,
            feedback: evaluation.feedback,
            gradedManually: false,
            gradeSource: 'AUTOGRADER',
            ...groupProvenance,
          })),
          skipDuplicates: true,
        });
      });

      await logSubmissionActivity(submission, 'SUBMISSION_AUTOGRADED', 'INFO', {
        studentId: submission.studentId,
        grade: earnedPoints,
        maxPoints: submission.assignmentProblem.maxPoints,
        correct: evaluation.correct ?? null,
      });

      console.log(
        `[SubmissionWorker] Auto-graded submission ${id}: ${earnedPoints} points (correct: ${evaluation.correct})`,
      );
    }

    console.log(`[SubmissionWorker] Successfully evaluated submission ${id}`);
  } catch (error) {
    const message = errMessage(error);

    // This catch only fires on unexpected/transient errors (DB blip, evaluator
    // crash). Known bad-input cases come back as evaluation.status === 'FAILED'
    // above and never reach here. So retry by returning to PENDING until we've
    // burned through the attempt budget, then fail it for good.
    const giveUp = (submission?.attempts ?? maxAttempts) >= maxAttempts;

    if (submission) {
      // Distinguish a will-retry error from a permanent give-up (can't grade it).
      await logSubmissionActivity(
        submission,
        giveUp ? 'SUBMISSION_FAILED_PERMANENTLY' : 'SUBMISSION_ERROR',
        'ERROR',
        { error: message, attempts: submission.attempts },
      );
    }

    console.error(`[SubmissionWorker] Failed submission ${id}:`, error);

    // Fenced so a stale worker can't flip a row another worker has since re-claimed.
    await writeIfStillOwned(
      id,
      token,
      giveUp
        ? {
            status: 'FAILED',
            feedback: 'Autograder failed while processing this submission.',
            evaluationRaw: message as Prisma.InputJsonValue,
            // Finished with it either way: the row is no longer being worked on.
            processingToken: null,
          }
        : { status: 'PENDING', processingToken: null },
    );
  }
}

// Internal worker steps, exposed for unit tests only. Not part of the module's
// public API; production code drives the queue via startSubmissionWorker().
export const __test__ = {
  evaluateSubmission,
  runJavaEvaluator,
  reapStuckSubmissions,
  runWorkerLoop,
  idleDelayMs,
  markWorkSeen: () => {
    lastWorkAt = Date.now();
  },
};

async function runJavaEvaluator(
  submission: WorkerSubmission,
  config: EvaluatorConfig,
): Promise<SubmissionEvaluationResult> {
  // The shape every failure guard returns (FAILED, no raw payload).
  const fail = (feedback: string, correct?: boolean): SubmissionEvaluationResult => ({
    feedback,
    correct,
    evaluationRaw: null,
    status: 'FAILED',
  });

  if (!submission.fileName) {
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
      error: 'No file submitted.',
    });
    return fail('No file submitted.', false);
  }

  try {
    const uploadedFilePath = path.join('/private', 'uploads', 'submissions', submission.fileName);
    if (!fs.existsSync(uploadedFilePath)) {
      await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
        error: 'Uploaded file not found.',
      });
      return fail('ERROR: Uploaded file not found.', false);
    }

    // Windows local dev (no evaluator JAR): just report the line count as a stand-in.
    const isDocker = process.env.CFGANALYZER_BINARY !== undefined;
    if (!isDocker && os.platform() === 'win32') {
      const result = execSync(`powershell -Command "(Get-Content '${uploadedFilePath}').Count"`, {
        encoding: 'utf-8',
      });
      return {
        feedback: `File has ${result.trim()} lines (Windows).`,
        correct: undefined,
        evaluationRaw: null,
        status: 'COMPLETED',
      };
    }

    // Docker/Linux: run afct-evaluator.jar against the problem's answer key.
    const answerFileName = submission.assignmentProblem.problem.fileName;
    if (!answerFileName) {
      await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
        error: 'No answer file configured for this problem.',
      });
      return fail('ERROR: No answer file configured for this problem.');
    }

    const answerFilePath = path.join('/private', 'uploads', 'solutions', answerFileName);
    if (!fs.existsSync(answerFilePath)) {
      await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
        error: 'Answer file not found on server.',
        answerFilePath,
      });
      return fail('ERROR: Answer file not found on server.');
    }

    return await evaluateWithJar(submission, config, answerFilePath, uploadedFilePath);
  } catch (cmdErr) {
    const feedback = `ERROR: Evaluation failed - ${cmdErr instanceof Error ? cmdErr.message : 'Unknown error'}`;
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
      error: feedback,
    });
    console.error(`[SubmissionWorker] Command error for submission ${submission.id}:`, cmdErr);
    return fail(feedback, false);
  }
}

/**
 * Grade a submission with the evaluator: run the jar, then do the things that only
 * make sense for a real submission (activity logging, the similarity report). The
 * jar call itself lives in `evaluator-runner.ts`, shared with the trial page.
 */
async function evaluateWithJar(
  submission: WorkerSubmission,
  config: EvaluatorConfig,
  answerFilePath: string,
  uploadedFilePath: string,
): Promise<SubmissionEvaluationResult> {
  const run = await runEvaluatorJar({
    answerFilePath,
    uploadedFilePath,
    config,
    problem: submission.assignmentProblem.problem,
  });

  if (run.stderr) {
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_STDERR', 'WARNING', {
      stderr: run.stderr.substring(0, 500),
    });
    console.warn(
      `[SubmissionWorker] Evaluator stderr for submission ${submission.id}: ${run.stderr.substring(0, 100)}`,
    );
  }

  if (run.outcome === 'error') {
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
      error: run.error,
    });
    console.error(`[SubmissionWorker] Evaluator error for submission ${submission.id}:`, run.error);
    return {
      feedback: `ERROR: Evaluation failed - ${run.error}`,
      correct: undefined,
      evaluationRaw: null,
      status: 'FAILED',
    };
  }

  if (run.outcome === 'unparsable') {
    const errorMessage = `Failed to parse evaluation result - ${run.stdout}`;
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
      error: errorMessage,
      parseError: run.parseError,
      stdout: run.stdout,
    });
    console.error(
      `[SubmissionWorker] Failed to parse evaluator output for submission ${submission.id}:`,
      run.parseError,
    );
    return {
      feedback: `ERROR: ${errorMessage}`,
      correct: undefined,
      evaluationRaw: run.stdout || null,
      status: 'FAILED',
    };
  }

  if (run.outcome === 'invalid-json') {
    const errorMessage = `Invalid JSON response from evaluator: ${run.stdout}`;
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
      error: errorMessage,
      stdout: run.stdout,
    });
    return {
      feedback: `ERROR: ${errorMessage}`,
      correct: undefined,
      evaluationRaw: run.evaluation,
      status: 'FAILED',
    };
  }

  await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_SUCCESS', 'INFO', {
    correct: run.correct ?? false,
    evaluation: run.evaluation,
  });

  return {
    feedback: run.feedback,
    correct: run.correct,
    evaluationRaw: run.evaluation,
    status: 'COMPLETED',
  };
}
