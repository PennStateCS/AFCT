import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const {submission, action, metadata } = body;
    
  await createEnhancedActivityLog(
    prisma,
    req,
    buildSubmissionLogPayload(submission, action, metadata),
  );
}

function buildSubmissionLogPayload(submission: any, action: string, metadata: Record<string, unknown> = {}) {
  return {
    userId: submission.studentId ?? null,
    action,
    category: 'SUBMISSION' as const,
    courseId: submission.assignment?.courseId ?? null,
    assignmentId: submission.assignmentId ?? null,
    problemId: submission.problemId ?? null,
    submissionId: submission.id ?? null,
    metadata: {
      submissionId: submission.id,
      ...metadata,
    },
  };
}