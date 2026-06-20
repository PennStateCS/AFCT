import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { SubmissionStatus } from "@prisma/client";

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

import JavaRunner from '../../lib/java-runner';
import { Truculenta } from 'next/font/google';

// Basic variables (probally should put some of these in a GUI or .env file except *)
let workerStarted = false; // *
let activeWorkers = 0; // *
const MAX_WORKERS = 5;
const MAX_EVAL_TIME = 30_000; // 30 seconds limit

type SubmissionEvaluationStatus = keyof typeof SubmissionStatus;

interface SubmissionEvaluationResult {
  feedback: string | null;
  correct?: boolean;
  evaluationRaw: unknown | null;
  status: SubmissionEvaluationStatus;
}

async function logSubmissionActivity(submission: any, action: string, metadata: any) {
  try {
    const HOST = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    await fetch(`${HOST}/api/log_submission`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        submission: submission,
        action: action,
        metadata: metadata,
      }),
    });
  } catch (error) {
    console.error(error);
  }
}

export function startSubmissionWorker() {
  // Worker already started
  if (workerStarted) {
    console.error("[SubmissionWorker] Already started");
    return;
  }

  // Start worker loops concurrently
  for (let i = 0; i < MAX_WORKERS; i++) {
    void runWorkerLoop();
  }
  
  workerStarted = true;
  console.log("[SubmissionWorker] Started safely");
}


async function runWorkerLoop() {
  // Check if semaphore is full
  if (activeWorkers >= MAX_WORKERS) {
    setTimeout(runWorkerLoop, 100); // Small sleep because the queue is full
    return;
  }

  try {
    // Get next submission
    const nextSubmission = await prisma.submission.findFirst({
      where: { status: 'PENDING' },
      orderBy: [
        { student : { role : 'asc' } },
        { assignmentProblem: { assignment: { dueDate: 'asc' } } },
      ],
      select: { id: true }
    });

    // No work to be done
    if (nextSubmission === null) {
      setTimeout(runWorkerLoop, 3_000); // Larger sleep bececause there is no rush
      return;
    }

    // Claim this submission
    const claimed = await prisma.submission.updateMany({
      where: { id: nextSubmission!.id, status: 'PENDING' },
      data: { status: 'PROCESSING' }
    });

    // If count is 0, another horizontal server instance grabbed it first. Move on.
    if (claimed.count === 0) {
      setTimeout(runWorkerLoop, 100); // Small sleep because it could be full
      return;
    }

    // Claim a worker slot
    activeWorkers++;
    try {
      evaluateSubmission(nextSubmission!.id);
    } finally {
      activeWorkers--;
    }

    // Move to next check
    setTimeout(runWorkerLoop, 100); // Small sleep as code ran and could be full
    return;
  } catch (error) {
    console.error("[SubmissionWorker] Database or loop error:", error);
    setTimeout(runWorkerLoop, 5_000); // Super long sleep due to error
    return;
  }
}


async function evaluateSubmission(id: string) {
  let submission: any | null = null;

  try {
    submission = await prisma.submission.findUnique({
      where: { id },
      include: {
        assignmentProblem: {
          select: {
            problem: {
              select: {
                fileName: true,
                type: true,
                maxStates: true,
                isDeterministic: true,
              }
            },
            assignmentId: true,
            problemId: true,
            maxPoints: true,
            autograderEnabled: true,
          },
        },
        student: true,
      },
    });

    if (!submission) {
      console.error(`[SubmissionWorker] Submission ${id} not found`);
      return;
    }

    // Run Java evaluator
    const evaluation = await runJavaEvaluator(submission);

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

      console.log(
        `[SubmissionWorker] Auto-graded submission ${id}: ${earnedPoints} points (correct: ${evaluation.correct})`,
      );
    }

    console.log(`[SubmissionWorker] Successfully evaluated submission ${id}`);
  } catch (error) {
    if (submission) {
      await logSubmissionActivity(submission, 'SUBMISSION_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    console.error(`[SubmissionWorker] Failed submission ${id}:`, error);

    await prisma.submission.update({
      where: { id },
      data: {
        status: 'FAILED',
        feedback: 'Autograder failed while processing this submission.',
        evaluationRaw:
          error instanceof Error ? (error.message as Prisma.InputJsonValue) : (String(error) as Prisma.InputJsonValue),
      },
    });
  }
}


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
      options?: { timeout?: number },
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
          options?: { timeout?: number },
        ) => Promise<{
          stdout?: string;
          stderr?: string;
          exitCode?: number;
        }>;
      }
    )(jarPath) as {
      execute: (
        args: string[],
        options?: { timeout?: number },
      ) => Promise<{
        stdout?: string;
        stderr?: string;
        exitCode?: number;
      }>;
    };
  }
}


async function runJavaEvaluator(submission: any): Promise<SubmissionEvaluationResult> {
  let feedback: string | null = null;
  let correct: boolean | undefined = undefined;
  let evaluationRaw: unknown | null = null;
  let status: SubmissionEvaluationStatus = 'COMPLETED';

  // No file submitted
  if (!submission.fileName) {
    status = 'FAILED';
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', {
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
      await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', {
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
        await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', {
          error: 'No answer file configured for this problem.',
        });
      } else {
        const answerFilePath = path.join('/private', 'uploads', 'solutions', answerFileName);

        // Check if answer file exists
        if (!fs.existsSync(answerFilePath)) {
          status = 'FAILED';
          feedback = 'ERROR: Answer file not found on server.';
          await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', {
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

            // Execute the evaluator with 30 second timeout
            const result = await evaluator.execute(args, {
              timeout: MAX_EVAL_TIME,
            });

            const stdoutTrimmed = result.stdout?.trim() ?? '';
            const stderrTrimmed = result.stderr?.trim() ?? '';
            if (stderrTrimmed) {
              await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_STDERR', {
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

                await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_SUCCESS', {
                  correct: correct ?? false,
                  evaluation,
                });
              } else {
                status = 'FAILED';
                const errorMessage = `Invalid JSON response from evaluator: ${stdoutTrimmed}`;
                await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', {
                  error: errorMessage,
                  stdout: stdoutTrimmed,
                });
                feedback = `ERROR: ${errorMessage}`;
              }
            } catch (parseErr) {
              status = 'FAILED';
              evaluationRaw = stdoutTrimmed || null;
              const errorMessage = `Failed to parse evaluation result - ${stdoutTrimmed}`;
              await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', {
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
            await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', {
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
    await logSubmissionActivity(submission, 'SUBMISSION_EVALUATION_ERROR', {
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