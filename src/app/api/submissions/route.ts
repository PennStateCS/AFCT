// /src/app/api/submissions/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/app/utils/jwt';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import os from 'os';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';

// Import JavaRunner for JAR execution
import JavaRunner from '../../../../lib/java-runner';

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
          maxStates: true,
          isDeterministic: true,
          type: true,
        },
      },
    },
  });

  if (!link) {
    return NextResponse.json(
      { error: 'Problem is not linked to this assignment.' },
      { status: 400 },
    );
  }

  let fileName: string | null = null;
  let originalFileName: string | null = null;
  let feedback: string | null = null;
  let correct: boolean | undefined = undefined;

  try {
    // 4. Handle file upload
    if (file) {
      if (file.size > maxBytes) {
        return NextResponse.json(
          { error: `File exceeds max upload size (${maxMb} MB).` },
          { status: 413 },
        );
      }
      originalFileName = file.name;
      const fileExt = path.extname(originalFileName);
      fileName = `${randomUUID()}${fileExt}`;

      const uploadDir = path.join(process.cwd(), 'private', 'uploads', 'submissions');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer, {mode: 0o755});

      // 4b. Run system command to analyze the uploaded file
      try {
        // Check if we're running in Docker (has CFGANALYZER_BINARY env var)
        const isDocker = process.env.CFGANALYZER_BINARY !== undefined;
        
        if (!isDocker && os.platform() === 'win32') {
          // Windows local development: Count lines as before
          const result = execSync(`powershell -Command "(Get-Content '${filePath}').Count"`, {
            encoding: 'utf-8',
          });
          feedback = `File has ${result.trim()} lines (Windows).`;
        } else {
          // Docker/Linux: Use afct-evaluator.jar with JavaRunner
          const answerFileName = link.problem.fileName;
          if (answerFileName) {
            const answerFilePath = path.join(
              process.cwd(),
              'private',
              'uploads',
              'problems',
              answerFileName,
            );

            // Check if answer file exists
            if (fs.existsSync(answerFilePath)) {
              try {
                // Create JavaRunner instance for afct-evaluator.jar
                const evaluator = new JavaRunner('./jars/afct-evaluator.jar');

                // Build command arguments
                const args = ['--json', answerFilePath, filePath];

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
                  timeout: 30000
                });
                
                // Parse the JSON response
                try {
                  const evaluation = JSON.parse(result.stdout.trim());
                  if (evaluation && typeof evaluation === 'object') {
                    // Extract correct field if present
                    if (typeof evaluation.correct === 'boolean') {
                      correct = evaluation.correct;
                    }
                    
                    // Extract feedback if present
                    if (typeof evaluation.feedback === 'string') {
                      feedback = evaluation.feedback;
                    } else {
                      feedback = `Evaluation completed - correct: ${correct}`;
                    }
                  } else {
                    feedback = `ERROR: Invalid JSON response from evaluator: ${result.stdout.trim()}`;
                  }
                } catch (parseErr) {
                  console.error('Failed to parse evaluator JSON:', parseErr);
                  feedback = `ERROR: Failed to parse evaluation result - ${result.stdout.trim()}`;
                }
              } catch (evaluatorErr) {
                console.error('JavaRunner execution failed:', evaluatorErr);
                feedback = `ERROR: Evaluation failed - ${evaluatorErr instanceof Error ? evaluatorErr.message : 'Unknown error'}`;
              }
            } else {
              feedback = 'ERROR: Answer file not found on server.';
            }
          } else {
            feedback = 'ERROR: No answer file configured for this problem.';
          }
        }
      } catch (cmdErr) {
        console.error('Command execution failed:', cmdErr);
        const isDocker = process.env.CFGANALYZER_BINARY !== undefined;
        
        if (!isDocker && os.platform() === 'win32') {
          feedback = 'ERROR: Failed to analyze file.';
        } else {
          feedback = `ERROR: Evaluation failed - ${cmdErr instanceof Error ? cmdErr.message : 'Unknown error'}`;
        }
      }
    }

    // 5. Store the submission
    const submission = await prisma.submission.create({
      data: {
        assignmentId,
        problemId,
        studentId: decoded.userId,
        fileName,
        originalFileName,
        feedback,
        correct,
      },
    });

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

    return NextResponse.json(submission, { status: 201 });
  } catch (error: unknown) {
    console.error('Submission error:', error);

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
