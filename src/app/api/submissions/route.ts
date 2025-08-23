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
      metadata: {},
    });

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse multipart form data
  const formData = await req.formData();
  const assignmentId = formData.get('assignmentId')?.toString();
  const problemId = formData.get('problemId')?.toString();
  const file = formData.get('file') as File | null;

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
      originalFileName = file.name;
      const fileExt = path.extname(originalFileName);
      fileName = `${randomUUID()}${fileExt}`;

      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'submissions');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      // 4b. Run system command to analyze the uploaded file
      try {
        if (os.platform() === 'win32') {
          // Windows: Count lines as before
          const result = execSync(`powershell -Command "(Get-Content '${filePath}').Count"`, {
            encoding: 'utf-8',
          });
          feedback = `File has ${result.trim()} lines (Windows).`;
        } else {
          // Linux: Use afct-evaluator.jar
          const answerFileName = link.problem.fileName;
          if (answerFileName) {
            const answerFilePath = path.join(
              process.cwd(),
              'public',
              'uploads',
              'problems',
              answerFileName,
            );

            // Check if answer file exists
            if (fs.existsSync(answerFilePath)) {
              // Build command arguments
              const args = ['-jar', 'afct-evaluator.jar', '--json', answerFilePath, filePath];

              // Add optional arguments based on problem type
              if (link.problem.type === 'FA' || link.problem.type === 'PDA') {
                const maxStates = link.problem.maxStates ?? -1;
                args.push(maxStates.toString());

                if (link.problem.type === 'FA') {
                  const deterministic = link.problem.isDeterministic ?? false;
                  args.push(deterministic.toString());
                }
              }

              // Execute the evaluator
              const result = execSync(`java ${args.join(' ')}`, {
                encoding: 'utf-8',
                timeout: 30000, // 30 second timeout
              });
              
              // Parse the JSON response
              try {
                const evaluation = JSON.parse(result.trim());
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
                  feedback = `ERROR: Invalid JSON response from evaluator: ${result.trim()}`;
                }
              } catch (parseErr) {
                console.error('Failed to parse evaluator JSON:', parseErr);
                feedback = `ERROR: Failed to parse evaluation result - ${result.trim()}`;
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
        if (os.platform() === 'win32') {
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
      assignmentId,
      problemId,
      submissionId: submission.id,
      metadata: {
        fileName,
      },
    });

    return NextResponse.json(submission, { status: 201 });
  } catch (error) {
    console.error('Submission error:', error);

    await createEnhancedActivityLog(prisma, req, {
      userId: decoded.userId,
      action: 'SUBMISSION_ERROR',
      category: 'SUBMISSION',
      assignmentId,
      problemId,
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 });
  }
}
