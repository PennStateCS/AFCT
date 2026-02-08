import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import JavaRunner from '../../../../../../lib/java-runner';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const session = await auth();
    const user = session?.user;

    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const submission = await prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
        assignmentId: true,
        problemId: true,
        studentId: true,
        fileName: true,
        originalFileName: true,
      },
    });

    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    if (!submission.fileName) {
      return NextResponse.json({ error: 'Submission has no file' }, { status: 400 });
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id: submission.assignmentId },
      select: { courseId: true },
    });

    const link = await prisma.assignmentProblem.findUnique({
      where: {
        assignmentId_problemId: {
          assignmentId: submission.assignmentId,
          problemId: submission.problemId,
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

    const submissionPath = path.join('/private', 'uploads', 'submissions', submission.fileName);
    if (!fs.existsSync(submissionPath)) {
      return NextResponse.json({ error: 'Submission file not found' }, { status: 404 });
    }

    const answerFileName = link.problem.fileName;
    if (!answerFileName) {
      return NextResponse.json(
        { error: 'No answer file configured for this problem.' },
        { status: 400 },
      );
    }

    const answerFilePath = path.join('/private', 'uploads', 'solutions', answerFileName);
    if (!fs.existsSync(answerFilePath)) {
      return NextResponse.json({ error: 'Answer file not found on server.' }, { status: 404 });
    }

    let feedback: string | null = null;
    let correct: boolean | undefined = undefined;
    let evaluationRaw: unknown | null = null;

    try {
      const isDocker = process.env.CFGANALYZER_BINARY !== undefined;

      if (!isDocker && os.platform() === 'win32') {
        const result = execSync(`powershell -Command "(Get-Content '${submissionPath}').Count"`, {
          encoding: 'utf-8',
        });
        feedback = `File has ${result.trim()} lines (Windows).`;
      } else {
        const evaluator = new JavaRunner('./jars/afct-evaluator.jar');
        const args = ['--json', answerFilePath, submissionPath];

        if (link.problem.type === 'FA' || link.problem.type === 'PDA') {
          const maxStates = link.problem.maxStates ?? -1;
          args.push(maxStates.toString());

          if (link.problem.type === 'FA') {
            const deterministic = link.problem.isDeterministic ?? false;
            args.push(deterministic.toString());
          }
        }

        const result = await evaluator.execute(args, { timeout: 30000 });

        const stdoutTrimmed = result.stdout?.trim() ?? '';
        const stderrTrimmed = result.stderr?.trim() ?? '';
        const truncate = (val: string, max = 2000) =>
          val.length > max ? `${val.slice(0, max)}…` : val;

        if (stderrTrimmed) {
          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
            action: 'SUBMISSION_RERUN_STDERR',
            category: 'SUBMISSION',
            courseId: assignment?.courseId ?? null,
            assignmentId: submission.assignmentId,
            problemId: submission.problemId,
            submissionId: submission.id,
            metadata: {
              userId: user.id,
              assignmentId: submission.assignmentId,
              problemId: submission.problemId,
              submissionId: submission.id,
              stderr: truncate(stderrTrimmed),
            },
          });
        }

        try {
          const evaluation = JSON.parse(stdoutTrimmed);
          evaluationRaw = evaluation;
          if (evaluation && typeof evaluation === 'object') {
            if (typeof evaluation.correct === 'boolean') {
              correct = evaluation.correct;
            }

            if (typeof evaluation.feedback === 'string') {
              const isJavaStreamString = /java\.lang\..*Stream@/i.test(evaluation.feedback);
              feedback = isJavaStreamString
                ? `Evaluation completed - correct: ${correct}`
                : evaluation.feedback;
            } else {
              feedback = `Evaluation completed - correct: ${correct}`;
            }
          } else {
            feedback = `ERROR: Invalid JSON response from evaluator: ${stdoutTrimmed}`;
          }
        } catch (parseErr) {
          evaluationRaw = stdoutTrimmed || null;
          feedback = `ERROR: Failed to parse evaluation result - ${stdoutTrimmed}`;
          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
            action: 'SUBMISSION_RERUN_ERROR',
            category: 'SUBMISSION',
            courseId: assignment?.courseId ?? null,
            assignmentId: submission.assignmentId,
            problemId: submission.problemId,
            submissionId: submission.id,
            metadata: {
              userId: user.id,
              assignmentId: submission.assignmentId,
              problemId: submission.problemId,
              submissionId: submission.id,
              error: feedback,
              parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
            },
          });
        }
      }
    } catch (evaluatorErr) {
      feedback = `ERROR: Evaluation failed - ${
        evaluatorErr instanceof Error ? evaluatorErr.message : 'Unknown error'
      }`;
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SUBMISSION_RERUN_ERROR',
        category: 'SUBMISSION',
        courseId: assignment?.courseId ?? null,
        assignmentId: submission.assignmentId,
        problemId: submission.problemId,
        submissionId: submission.id,
        metadata: {
          userId: user.id,
          assignmentId: submission.assignmentId,
          problemId: submission.problemId,
          submissionId: submission.id,
          error: feedback,
        },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (prisma as any).submission.update({
      where: { id: submission.id },
      data: {
        feedback,
        correct,
        evaluationRaw,
      },
      select: {
        id: true,
        feedback: true,
        correct: true,
        evaluationRaw: true,
        updatedAt: true,
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'SUBMISSION_RERUN',
      category: 'SUBMISSION',
      courseId: assignment?.courseId ?? null,
      assignmentId: submission.assignmentId,
      problemId: submission.problemId,
      submissionId: submission.id,
      metadata: {
        userId: user.id,
        assignmentId: submission.assignmentId,
        problemId: submission.problemId,
        submissionId: submission.id,
        correct: updated.correct,
      },
    });

    return NextResponse.json({ success: true, submission: updated }, { status: 200 });
  } catch (error) {
    console.error('POST /api/submissions/[id]/rerun error:', error);
    return NextResponse.json({ error: 'Failed to rerun submission' }, { status: 500 });
  }
}
