// /src/app/api/submissions/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { verifyToken } from '@/app/utils/jwt';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import os from 'os';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { XMLParser, XMLValidator } from "fast-xml-parser";

// Import JavaRunner for JAR execution
import JavaRunner from '../../../../lib/java-runner';

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

export async function POST(req: NextRequest) {
  // 1. Verify token
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  const decoded = token ? verifyToken(token) : null;

  if (!decoded) {
    console.warn('Unauthorized submission attempt');
    await createEnhancedActivityLog(prisma, req, {
      userId: undefined,
      action: 'SUBMISSION_UNAUTHORIZED',
      category: 'SUBMISSION',
      metadata: { userId: undefined },
    });

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse multipart form data
  const formData = await req.formData();
  const courseId = formData.get('courseId')?.toString();
  const assignmentId = formData.get('assignmentId')?.toString();
  const problemId = formData.get('problemId')?.toString();
  const file = formData.get('file') as File | null;
  const { maxBytes, maxMb } = await getSystemUploadLimit();

  if (!assignmentId || !problemId) {
    await createEnhancedActivityLog(prisma, req, {
      userId: decoded.userId,
      action: 'SUBMISSION_INVALID_REQUEST',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: decoded.userId,
        courseId,
        assignmentId,
        problemId,
        error: 'Missing required fields',
      },
    });
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // 3. Ensure the problem is linked to the assignment and get problem details
  const link = await prisma.assignmentProblem.findUnique({
    where: {
      assignmentId_problemId: {
        assignmentId,
        problemId,
      },
    },
    include: {
      problem: {
        select: {
          fileName: true,
          maxPoints: true,
          maxStates: true,
          autograderEnabled: true,
          isDeterministic: true,
          type: true,
        },
      },
    },
  });

  if (!link) {
    await createEnhancedActivityLog(prisma, req, {
      userId: decoded.userId,
      action: 'SUBMISSION_INVALID_REQUEST',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: decoded.userId,
        courseId,
        assignmentId,
        problemId,
        error: 'Problem is not linked to this assignment.',
      },
    });
    return NextResponse.json(
      { error: 'Problem is not linked to this assignment.' },
      { status: 400 },
    );
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      dueDate: true,
      allowLateSubmissions: true,
      lateCutoff: true,
    },
  });

  if (!assignment) {
    await createEnhancedActivityLog(prisma, req, {
      userId: decoded.userId,
      action: 'SUBMISSION_INVALID_REQUEST',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: decoded.userId,
        courseId,
        assignmentId,
        problemId,
        error: 'Assignment not found.',
      },
    });
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
  }

  const now = new Date();
  const isLate = now > assignment.dueDate;

  if (isLate) {
    if (!assignment.allowLateSubmissions) {
      await createEnhancedActivityLog(prisma, req, {
        userId: decoded.userId,
        action: 'SUBMISSION_REJECTED_LATE',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: decoded.userId,
          courseId,
          assignmentId,
          problemId,
          dueDate: assignment.dueDate.toISOString(),
          allowLateSubmissions: assignment.allowLateSubmissions,
          lateCutoff: assignment.lateCutoff ? assignment.lateCutoff.toISOString() : null,
          submittedAt: now.toISOString(),
          reason: 'Late submissions are not allowed for this assignment.',
        },
      });
      return NextResponse.json(
        { error: 'Late submissions are not allowed for this assignment.' },
        { status: 403 },
      );
    }

    if (assignment.lateCutoff && now > assignment.lateCutoff) {
      await createEnhancedActivityLog(prisma, req, {
        userId: decoded.userId,
        action: 'SUBMISSION_REJECTED_LATE_CUTOFF',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: decoded.userId,
          courseId,
          assignmentId,
          problemId,
          dueDate: assignment.dueDate.toISOString(),
          allowLateSubmissions: assignment.allowLateSubmissions,
          lateCutoff: assignment.lateCutoff.toISOString(),
          submittedAt: now.toISOString(),
          reason: 'Late submission cutoff has passed for this assignment.',
        },
      });
      return NextResponse.json(
        { error: 'Late submission cutoff has passed for this assignment.' },
        { status: 403 },
      );
    }
  }

  let fileName: string | null = null;
  let originalFileName: string | null = null;
  let feedback: string | null = null;
  let correct: boolean | undefined = undefined;
  let evaluationRaw: unknown | null = null;
  let uploadedFilePath: string | null = null;

  if (file){
    const xml = await file.text();
  
    const parser = new XMLParser();
  
    const isValidXml = XMLValidator.validate(xml);

    if (isValidXml !== true){
      return NextResponse.json({ error: 'Submission file not xml' }, { status: 400 });
    }

    const jff = parser.parse(xml);

    if (!jff.structure || jff.structure.type.toUpperCase() !== ((link.problem.type === 'CFG') ? 'GRAMMAR' : link.problem.type)){
      return NextResponse.json({ error: `Submission file should be of type ${link.problem.type}` }, { status: 400 });
    }
  }

  try {
    // 4. Handle file upload
    if (file) {
      await createEnhancedActivityLog(prisma, req, {
        userId: decoded.userId,
        action: 'SUBMISSION_FILE_RECEIVED',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: decoded.userId,
          courseId,
          assignmentId,
          problemId,
          fileName: file.name,
          fileSizeBytes: file.size,
          fileType: file.type,
        },
      });
      if (file.size > maxBytes) {
        return NextResponse.json(
          { error: `File exceeds max upload size (${maxMb} MB).` },
          { status: 413 },
        );
      }
      originalFileName = file.name;
      const fileExt = path.extname(originalFileName);
      fileName = `${randomUUID()}${fileExt}`;

      const uploadDir = path.join('/private', 'uploads', 'submissions');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer, { mode: 0o755 });
      uploadedFilePath = filePath;
    }

    // 5. Store the submission
    let submission = await prisma.submission.create({
      data: {
        assignmentId,
        problemId,
        studentId: decoded.userId,
        fileName,
        originalFileName,
        feedback,
        correct,
        evaluationRaw:
          evaluationRaw === null ? Prisma.JsonNull : (evaluationRaw as Prisma.InputJsonValue),
      },
    });

    if (fileName) {
      await createEnhancedActivityLog(prisma, req, {
        userId: decoded.userId,
        action: 'SUBMISSION_FILE_STORED',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        submissionId: submission.id,
        metadata: {
          userId: decoded.userId,
          courseId,
          assignmentId,
          problemId,
          submissionId: submission.id,
          fileName,
          originalFileName,
        },
      });
    }

    // 6. Log successful submission
    await createEnhancedActivityLog(prisma, req, {
      userId: decoded.userId,
      action: 'SUBMISSION_CREATED',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      submissionId: submission.id,
      metadata: {
        userId: decoded.userId,
        courseId: courseId,
        assignmentId: assignmentId,
        problemId: problemId,
        submissionId: submission.id,
        fileName: fileName,
      },
    });

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
                  timeout: 30000,
                });

                const stdoutTrimmed = result.stdout?.trim() ?? '';
                const stderrTrimmed = result.stderr?.trim() ?? '';
                const truncate = (val: string, max = 2000) =>
                  val.length > max ? `${val.slice(0, max)}…` : val;
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
                      stderr: truncate(stderrTrimmed),
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
  } catch (error: unknown) {
    await createEnhancedActivityLog(prisma, req, {
      userId: decoded.userId,
      action: 'SUBMISSION_ERROR',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: decoded.userId,
        courseId: courseId,
        assignmentId: assignmentId,
        problemId: problemId,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 });
  }
}
