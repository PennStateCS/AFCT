import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { SubmissionStatus } from "@prisma/client";

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

import JavaRunner from '../../lib/java-runner';
import { getEvaluatorConfig, getQueueSettings, type EvaluatorConfig } from './eval-config';
import { createEnhancedActivityLog, type LogSeverity } from './activity-log-utils';
import {
  DEFAULT_SUBMISSION_MAX_CONCURRENT,
  DEFAULT_SUBMISSION_MAX_ATTEMPTS,
} from './system-settings';

// The activity logger expects a Request (for IP/user-agent). The worker has no
// real request, so hand it a stand-in; IP and UA simply come back empty.
const WORKER_REQUEST = new Request('http://submission-worker.local');

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

let workerStarted = false;

// Concurrency is the number of live worker loops (each handles one submission at
// a time). desiredWorkers and maxAttempts are refreshed from SystemSettings, so
// an admin can retune the queue without a restart — see refreshQueueSettings().
let loopCount = 0;
let desiredWorkers = DEFAULT_SUBMISSION_MAX_CONCURRENT;
let maxAttempts = DEFAULT_SUBMISSION_MAX_ATTEMPTS;

const SETTINGS_REFRESH_MS = 30_000; // how often to re-read the queue settings
const REAP_INTERVAL_MS = 60_000; // how often to scan for stuck PROCESSING rows
const STUCK_GRACE_MS = 60_000; // grace beyond the eval timeout before a row is "stuck"

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
  metadata: Record<string, string | number | boolean | null>,
) {
  // Write straight to the DB — we're in the same process, so there's no reason
  // to go back out over HTTP. Only scalar ids are pulled off the submission;
  // never the full student record.
  try {
    await createEnhancedActivityLog(prisma, WORKER_REQUEST, {
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
    await createEnhancedActivityLog(prisma, WORKER_REQUEST, {
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
  // Worker already started
  if (workerStarted) {
    console.error("[SubmissionWorker] Already started");
    return;
  }
  workerStarted = true;

  // Spawn the initial pool from the defaults, then refresh from settings (which
  // adjusts the pool and reschedules itself).
  ensureWorkers();
  void refreshQueueSettings();

  // Start the reaper that recovers submissions left PROCESSING by a crash/restart
  void reapStuckSubmissions();

  console.log("[SubmissionWorker] Started safely");
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
      data: { status: 'PENDING' },
    });

    if (reaped.count > 0) {
      console.warn(`[SubmissionWorker] Reaped ${reaped.count} stuck submission(s) back to PENDING`);
      // Stuck PROCESSING rows almost always mean the server died mid-evaluation.
      await logQueueEvent('SUBMISSION_QUEUE_REAPED', 'WARNING', { count: reaped.count });
    }
  } catch (error) {
    console.error('[SubmissionWorker] Reaper error:', error);
    await logQueueEvent('SUBMISSION_QUEUE_REAPER_ERROR', 'ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    scheduleAsync(reapStuckSubmissions, REAP_INTERVAL_MS);
  }
}


async function runWorkerLoop() {
  // Scale down: if concurrency was lowered, retire this loop.
  if (loopCount > desiredWorkers) {
    loopCount--;
    return;
  }

  try {
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
        // Only add the filter when we have ids — an empty notIn is a Prisma footgun.
        ...(busyStudentIds.length ? { studentId: { notIn: busyStudentIds } } : {}),
      },
      orderBy: [
        { assignmentProblem: { assignment: { dueDate: 'asc' } } },
        { submittedAt: 'asc' },
      ],
      select: { id: true, attempts: true }
    });

    // No work to be done
    if (nextSubmission === null) {
      scheduleAsync(runWorkerLoop, 3_000); // Larger sleep bececause there is no rush
      return;
    }

    // Poison-pill guard: a submission that has been claimed too many times keeps
    // failing (or keeps getting reaped) — fail it rather than retry forever.
    if (nextSubmission.attempts >= maxAttempts) {
      const failed = await prisma.submission.updateMany({
        where: { id: nextSubmission.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          feedback: 'Autograder gave up after too many failed attempts.',
        },
      });
      // A student's submission can no longer be graded — surface it for staff.
      if (failed.count > 0) {
        const info = await prisma.submission.findUnique({
          where: { id: nextSubmission.id },
          select: { id: true, studentId: true, courseId: true, assignmentId: true, problemId: true },
        });
        if (info) {
          await logSubmissionActivity(info, 'SUBMISSION_FAILED_PERMANENTLY', 'ERROR', {
            attempts: nextSubmission.attempts,
            reason: 'exceeded max attempts',
          });
        }
      }
      scheduleAsync(runWorkerLoop, 100);
      return;
    }

    // The PENDING guard in the WHERE is the actual claim: the row flips to
    // PROCESSING in a single statement, so only one worker can win it.
    const claimed = await prisma.submission.updateMany({
      where: { id: nextSubmission.id, status: 'PENDING' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } }
    });

    // count === 0 means another loop/instance beat us to it. Move on.
    if (claimed.count === 0) {
      scheduleAsync(runWorkerLoop, 100); // Small sleep because it could be full
      return;
    }

    // Hold this loop until the evaluation finishes — one loop, one submission,
    // so the live loop count is the real concurrency limit.
    await evaluateSubmission(nextSubmission.id);

    // Move to next check
    scheduleAsync(runWorkerLoop, 100); // Small sleep as code ran and could be full
    return;
  } catch (error) {
    console.error("[SubmissionWorker] Database or loop error:", error);
    await logQueueEvent('SUBMISSION_QUEUE_ERROR', 'ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
    scheduleAsync(runWorkerLoop, 5_000); // Super long sleep due to error
    return;
  }
}


async function evaluateSubmission(id: string) {
  let submission: WorkerSubmission | null = null;

  try {
    submission = await prisma.submission.findUnique({
      where: { id },
      // Intentionally no `student: true` — the worker only needs the scalar
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

    await prisma.submission.update({
      where: { id },
      data: {
        feedback: evaluation.feedback,
        correct: evaluation.correct,
        evaluationRaw: evaluation.evaluationRaw === null ? Prisma.JsonNull : (evaluation.evaluationRaw as Prisma.InputJsonValue),
        status: evaluation.status,
      },
    });

    // Autograde submission if enabled
    if (submission.assignmentProblem.autograderEnabled === true) {
      const earnedPoints = evaluation.correct ? submission.assignmentProblem.maxPoints : 0;

      await prisma.assignmentProblemGrade.upsert({
        where: {
          assignmentId_problemId_studentId: {
            assignmentId: submission.assignmentId,
            problemId: submission.problemId,
            studentId: submission.studentId,
          },
        },
        create: {
          assignmentId: submission.assignmentId,
          problemId: submission.problemId,
          studentId: submission.studentId,
          grade: earnedPoints,
          feedback: evaluation.feedback,
        },
        update: {
          grade: earnedPoints,
          feedback: evaluation.feedback,
        },
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
    const message = error instanceof Error ? error.message : String(error);

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

    await prisma.submission.update({
      where: { id },
      data: giveUp
        ? {
            status: 'FAILED',
            feedback: 'Autograder failed while processing this submission.',
            evaluationRaw: message as Prisma.InputJsonValue,
          }
        : { status: 'PENDING' },
    });
  }
}


// Internal worker steps, exposed for unit tests only. Not part of the module's
// public API — production code drives the queue via startSubmissionWorker().
export const __test__ = {
  evaluateSubmission,
  runJavaEvaluator,
  reapStuckSubmissions,
  runWorkerLoop,
};

function getJavaRunnerCtor() {
  const maybeCtor =
    typeof JavaRunner === 'function'
      ? JavaRunner
      : (JavaRunner as unknown as { default?: unknown })?.default;

  if (typeof maybeCtor !== 'function') {
    throw new Error('Java runner constructor is unavailable');
  }

  return maybeCtor as new (jarPath: string) => {
    execute: (
      args: string[],
      options?: { timeout?: number; maxMemoryMb?: number; env?: Record<string, string> },
    ) => Promise<{
      stdout?: string;
      stderr?: string;
      exitCode?: number;
    }>;
  };
}


function createJavaRunner(jarPath: string) {
  const JavaRunnerCtor = getJavaRunnerCtor();
  try {
    return new JavaRunnerCtor(jarPath);
  } catch {
    return (
      JavaRunnerCtor as unknown as (path: string) => {
        execute: (
          args: string[],
          options?: { timeout?: number; maxMemoryMb?: number; env?: Record<string, string> },
        ) => Promise<{
          stdout?: string;
          stderr?: string;
          exitCode?: number;
        }>;
      }
    )(jarPath) as {
      execute: (
        args: string[],
        options?: { timeout?: number; maxMemoryMb?: number; env?: Record<string, string> },
      ) => Promise<{
        stdout?: string;
        stderr?: string;
        exitCode?: number;
      }>;
    };
  }
}


async function runJavaEvaluator(
  submission: WorkerSubmission,
  config: EvaluatorConfig,
): Promise<SubmissionEvaluationResult> {
  let feedback: string | null = null;
  let correct: boolean | undefined = undefined;
  let evaluationRaw: unknown | null = null;
  let status: SubmissionEvaluationStatus = 'COMPLETED';

  // No file submitted
  if (!submission.fileName) {
    status = 'FAILED';
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
      error: 'No file submitted.',
    });

    return {
      feedback: 'No file submitted.',
      correct: false,
      evaluationRaw: null,
      status,
    };
  }

  try {
    const uploadedFilePath = path.join('/private', 'uploads', 'submissions', submission.fileName);

    // Check if uploaded file exists
    if (!fs.existsSync(uploadedFilePath)) {
      status = 'FAILED';
      await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
        error: 'Uploaded file not found.',
      });

      return {
        feedback: 'ERROR: Uploaded file not found.',
        correct: false,
        evaluationRaw: null,
        status,
      };
    }

    // Check if we're running in Docker
    const isDocker = process.env.CFGANALYZER_BINARY !== undefined;

    if (!isDocker && os.platform() === 'win32') {
      // Windows local development: Count lines
      const result = execSync(
        `powershell -Command "(Get-Content '${uploadedFilePath}').Count"`,
        { encoding: 'utf-8' },
      );
      feedback = `File has ${result.trim()} lines (Windows).`;
    } else {
      // Docker/Linux: Use afct-evaluator.jar with JavaRunner
      const answerFileName = submission.assignmentProblem.problem.fileName;

      if (!answerFileName) {
        status = 'FAILED';
        feedback = 'ERROR: No answer file configured for this problem.';
        await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
          error: 'No answer file configured for this problem.',
        });
      } else {
        const answerFilePath = path.join('/private', 'uploads', 'solutions', answerFileName);

        // Check if answer file exists
        if (!fs.existsSync(answerFilePath)) {
          status = 'FAILED';
          feedback = 'ERROR: Answer file not found on server.';
          await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
            error: 'Answer file not found on server.',
            answerFilePath,
          });
        } else {
          try {
            // Create JavaRunner instance for afct-evaluator.jar
            const evaluator = createJavaRunner('./jars/afct-evaluator.jar');

            // Build command arguments
            const args = ['--json', answerFilePath, uploadedFilePath];

            // Add optional arguments based on problem type
            if (submission.assignmentProblem.problem.type === 'FA' || submission.assignmentProblem.problem.type === 'PDA') {
              const maxStates = submission.assignmentProblem.problem.maxStates ?? -1;
              args.push(maxStates.toString());

              if (submission.assignmentProblem.problem.type === 'FA') {
                const deterministic = submission.assignmentProblem.problem.isDeterministic ?? false;
                args.push(deterministic.toString());
              }
            }

            // Execute the evaluator with the configured timeout, memory cap, and
            // analyzer bound (overrides the CFGANALYZER_LIMIT env default).
            const result = await evaluator.execute(args, {
              timeout: config.timeoutMs,
              maxMemoryMb: config.maxMemoryMb,
              env: { CFGANALYZER_LIMIT: String(config.analyzerLimit) },
            });

            const stdoutTrimmed = result.stdout?.trim() ?? '';
            const stderrTrimmed = result.stderr?.trim() ?? '';
            if (stderrTrimmed) {
              await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_STDERR', 'WARNING', {
                stderr: stderrTrimmed.substring(0, 500),
              });

              console.warn(
                `[SubmissionWorker] Evaluator stderr for submission ${submission.id}: ${stderrTrimmed.substring(0, 100)}`,
              );
            }

            // Parse the JSON response
            try {
              const evaluation = JSON.parse(stdoutTrimmed);
              evaluationRaw = evaluation;

              if (evaluation && typeof evaluation === 'object') {
                // Extract correct field if present
                if (typeof evaluation.correct === 'boolean') {
                  correct = evaluation.correct;
                }

                // Extract feedback if present
                if (typeof evaluation.feedback === 'string') {
                  const isJavaStreamString = /java\.lang\..*Stream@/i.test(evaluation.feedback);
                  feedback = isJavaStreamString
                    ? `Evaluation completed - correct: ${correct}`
                    : evaluation.feedback;
                } else {
                  feedback = `Evaluation completed - correct: ${correct}`;
                }

                await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_SUCCESS', 'INFO', {
                  correct: correct ?? false,
                  evaluation,
                });
              } else {
                status = 'FAILED';
                const errorMessage = `Invalid JSON response from evaluator: ${stdoutTrimmed}`;
                await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
                  error: errorMessage,
                  stdout: stdoutTrimmed,
                });
                feedback = `ERROR: ${errorMessage}`;
              }
            } catch (parseErr) {
              status = 'FAILED';
              evaluationRaw = stdoutTrimmed || null;
              const errorMessage = `Failed to parse evaluation result - ${stdoutTrimmed}`;
              await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
                error: errorMessage,
                parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
                stdout: stdoutTrimmed,
              });
              feedback = `ERROR: ${errorMessage}`;
              console.error(
                `[SubmissionWorker] Failed to parse evaluator output for submission ${submission.id}:`,
                parseErr,
              );
            }
          } catch (evaluatorErr) {
            status = 'FAILED';
            const errorMessage = evaluatorErr instanceof Error ? evaluatorErr.message : String(evaluatorErr);
            await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
              error: errorMessage,
            });
            feedback = `ERROR: Evaluation failed - ${errorMessage}`;
            console.error(
              `[SubmissionWorker] Evaluator error for submission ${submission.id}:`,
              evaluatorErr,
            );
          }
        }
      }
    }

    return {
      feedback,
      correct,
      evaluationRaw: evaluationRaw === null ? null : evaluationRaw,
      status,
    };
  } catch (cmdErr) {
    status = 'FAILED';
    feedback = `ERROR: Evaluation failed - ${cmdErr instanceof Error ? cmdErr.message : 'Unknown error'}`;
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', 'ERROR', {
      error: feedback,
    });
    console.error(`[SubmissionWorker] Command error for submission ${submission.id}:`, cmdErr);

    return {
      feedback,
      correct: false,
      evaluationRaw: null,
      status,
    };
  }
}
