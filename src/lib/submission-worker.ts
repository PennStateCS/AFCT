import { prisma } from '@/lib/prisma';

let workerStarted = false;
let activeWorkers = 0;
const MAX_WORKERS = 5;
const MAX_EVAL_TIME = 30_000; // 30 seconds limit

export function startSubmissionWorker() {
  // Worker already started
  if (workerStarted) {
    console.error("[SubmissionWorker] Already started");
    return;
  }

  // Start worker
  runWorkerLoop();
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
      orderBy: { submittedAt: 'asc' },
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

    // Execute code
    evaluateSubmission(nextSubmission!.id);

    // No longer need worker slop
    activeWorkers--;

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
  try {
    const submission = await prisma.submission.findUnique({
      where: { id },
      include: {
        problem: true,
        assignment: true,
        student: true,
      },
    });

    // Run Java evaluator
    const result = await runJavaEvaluator(submission);

    await prisma.submission.update({
      where: { id },
      data: {
        feedback: result.feedback,
        correct: result.correct,
        evaluationRaw: result.raw,
        status: "COMPLETED",
      },
    });
  } catch (error) {
    console.error(`[SubmissionWorker] Failed submission ${id}:`, error);

    await prisma.submission.update({
      where: { id },
      data: {
        status: "FAILED",
        feedback: "Autograder failed while processing this submission.",
        evaluationRaw: String(error),
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


function runJavaEvaluator(submission) {
    if (uploadedFilePath) {
      // 4b. Run system command to analyze the uploaded file
      try {
        // Check if we're running in Docker (has CFGANALYZER_BINARY env var)
        const isDocker = process.env.CFGANALYZER_BINARY !== undefined;

        if (!isDocker && os.platform() === 'win32') {
          // Windows local development: Count lines as before
          const result = execSync(
            `powershell -Command "(Get-Content '${uploadedFilePath}').Count"`,
            {
              encoding: 'utf-8',
            },
          );
          feedback = `File has ${result.trim()} lines (Windows).`;
        } else {
          // Docker/Linux: Use afct-evaluator.jar with JavaRunner
          const answerFileName = link.problem.fileName;
          if (answerFileName) {
            const answerFilePath = path.join('/private', 'uploads', 'solutions', answerFileName);

            // Check if answer file exists
            if (fs.existsSync(answerFilePath)) {
              try {
                // Create JavaRunner instance for afct-evaluator.jar
                const evaluator = createJavaRunner('./jars/afct-evaluator.jar');

                // Build command arguments
                const args = ['--json', answerFilePath, uploadedFilePath];

                // Add optional arguments based on problem type
                if (link.problem.type === 'FA' || link.problem.type === 'PDA') {
                  const maxStates = link.problem.maxStates ?? -1;
                  args.push(maxStates.toString());

                  if (link.problem.type === 'FA') {
                    const deterministic = link.problem.isDeterministic ?? false;
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
                  await createEnhancedActivityLog(prisma, req, {
                    userId: decoded.userId,
                    action: 'SUBMISSION_EVALUATION_STDERR',
                    category: 'SUBMISSION',
                    courseId,
                    assignmentId,
                    problemId,
                    metadata: {
                      userId: decoded.userId,
                      courseId,
                      assignmentId,
                      problemId,
                      stderr: truncate(stderrTrimmed, 50),
                    },
                  });
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

                    await createEnhancedActivityLog(prisma, req, {
                      userId: decoded.userId,
                      action: 'SUBMISSION_EVALUATION_SUCCESS',
                      category: 'SUBMISSION',
                      courseId,
                      assignmentId,
                      problemId,
                      metadata: {
                        userId: decoded.userId,
                        courseId,
                        assignmentId,
                        problemId,
                        correct,
                        evaluation,
                      },
                    });
                  } else {
                    const errorMessage = `Invalid JSON response from evaluator: ${stdoutTrimmed}`;
                    await createEnhancedActivityLog(prisma, req, {
                      userId: decoded.userId,
                      action: 'SUBMISSION_EVALUATION_ERROR',
                      category: 'SUBMISSION',
                      courseId,
                      assignmentId,
                      problemId,
                      metadata: {
                        userId: decoded.userId,
                        courseId,
                        assignmentId,
                        problemId,
                        error: errorMessage,
                      },
                    });
                    feedback = `ERROR: ${errorMessage}`;
                  }
                } catch (parseErr) {
                  evaluationRaw = stdoutTrimmed || null;
                  const errorMessage = `Failed to parse evaluation result - ${stdoutTrimmed}`;
                  await createEnhancedActivityLog(prisma, req, {
                    userId: decoded.userId,
                    action: 'SUBMISSION_EVALUATION_ERROR',
                    category: 'SUBMISSION',
                    courseId,
                    assignmentId,
                    problemId,
                    metadata: {
                      userId: decoded.userId,
                      courseId,
                      assignmentId,
                      problemId,
                      error: errorMessage,
                      parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
                    },
                  });
                  feedback = `ERROR: ${errorMessage}`;
                }
              } catch (evaluatorErr) {
                await createEnhancedActivityLog(prisma, req, {
                  userId: decoded.userId,
                  action: 'SUBMISSION_EVALUATION_ERROR',
                  category: 'SUBMISSION',
                  courseId,
                  assignmentId,
                  problemId,
                  metadata: {
                    userId: decoded.userId,
                    courseId,
                    assignmentId,
                    problemId,
                    error:
                      evaluatorErr instanceof Error ? evaluatorErr.message : String(evaluatorErr),
                  },
                });
                feedback = `ERROR: Evaluation failed - ${evaluatorErr instanceof Error ? evaluatorErr.message : 'Unknown error'}`;
              }
            } else {
              await createEnhancedActivityLog(prisma, req, {
                userId: decoded.userId,
                action: 'SUBMISSION_EVALUATION_ERROR',
                category: 'SUBMISSION',
                courseId,
                assignmentId,
                problemId,
                metadata: {
                  userId: decoded.userId,
                  courseId,
                  assignmentId,
                  problemId,
                  error: 'Answer file not found on server.',
                  answerFilePath,
                },
              });
              feedback = 'ERROR: Answer file not found on server.';
            }
          } else {
            await createEnhancedActivityLog(prisma, req, {
              userId: decoded.userId,
              action: 'SUBMISSION_EVALUATION_ERROR',
              category: 'SUBMISSION',
              courseId,
              assignmentId,
              problemId,
              metadata: {
                userId: decoded.userId,
                courseId,
                assignmentId,
                problemId,
                error: 'No answer file configured for this problem.',
              },
            });
            feedback = 'ERROR: No answer file configured for this problem.';
          }
        }
      } catch (cmdErr) {
        const isDocker = process.env.CFGANALYZER_BINARY !== undefined;

        await createEnhancedActivityLog(prisma, req, {
          userId: decoded.userId,
          action: 'SUBMISSION_EVALUATION_ERROR',
          category: 'SUBMISSION',
          courseId,
          assignmentId,
          problemId,
          metadata: {
            userId: decoded.userId,
            courseId,
            assignmentId,
            problemId,
            error: cmdErr instanceof Error ? cmdErr.message : String(cmdErr),
          },
        });

        if (!isDocker && os.platform() === 'win32') {
          feedback = 'ERROR: Failed to analyze file.';
        } else {
          feedback = `ERROR: Evaluation failed - ${cmdErr instanceof Error ? cmdErr.message : 'Unknown error'}`;
        }
      }

      submission = await prisma.submission.update({
        where: { id: submission.id },
        data: {
          feedback,
          correct,
          evaluationRaw:
            evaluationRaw === null ? Prisma.JsonNull : (evaluationRaw as Prisma.InputJsonValue),
        },
      });
    }

    // 7. Autograde submission
    const assignmentProblemWithOverrides = link as typeof link & {
      autograderEnabled?: boolean | null;
      maxPoints?: number | null;
    };
    const autograderEnabled =
      assignmentProblemWithOverrides.autograderEnabled ?? link.problem.autograderEnabled;
    const maxPoints = assignmentProblemWithOverrides.maxPoints ?? link.problem.maxPoints;

    if (autograderEnabled === true && typeof correct === 'boolean') {
      const earnedPoints = correct ? (maxPoints ?? 0) : 0;

      await prisma.assignmentProblemGrade.upsert({
        where: {
          assignmentId_problemId_studentId: {
            assignmentId: assignmentId,
            problemId: problemId,
            studentId: decoded.userId,
          },
        },
        create: {
          assignmentId: assignmentId,
          problemId: problemId,
          studentId: decoded.userId,
          grade: earnedPoints,
          feedback: feedback,
        },
        update: {
          grade: earnedPoints,
          feedback: feedback,
        },
      });
    }

    return NextResponse.json(submission, { status: 201 });
}