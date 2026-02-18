// /src/api/courses/[id]/[aid]/add-problems/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { ProblemTypeEnum } from '@/schemas/problem';
import { z } from 'zod';

// Types
interface Id {
  id: string;
}

interface AssignmentProblemCount {
  _count: {
    submissions: number;
  };
  assignmentId: string;
  problemId: string;
}

const ProblemSettingsSchema = z.object({
  problemId: z.string(),
  maxPoints: z.number().min(0),
  maxSubmissions: z
    .number()
    .int()
    .refine((value) => value === -1 || value >= 1, {
      message: 'Max submissions must be -1 (unlimited) or at least 1.',
    }),
  autograderEnabled: z.boolean(),
});

type ProblemSettingsInput = z.infer<typeof ProblemSettingsSchema>;

// POST: Replace problems for a given assignment in a specific course
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; aid: string }> },
) {
  const { id: courseId, aid: assignmentId } = await params;

  try {
    // Get session and validate user role
    const session = await auth();
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Parse the request body with better error handling
    let body;
    try {
      const requestText = await req.text();
      // Request body text received
      if (!requestText || requestText.trim() === '') {
        return NextResponse.json({ error: 'Empty request body' }, { status: 400 });
      }
      body = JSON.parse(requestText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const problemIds: string[] = Array.isArray(body.problemIds) ? body.problemIds : [];
    const problemSettingsResult = ProblemSettingsSchema.array().safeParse(
      Array.isArray(body.problemSettings) ? body.problemSettings : [],
    );
    const problemSettings: ProblemSettingsInput[] = problemSettingsResult.success
      ? problemSettingsResult.data
      : [];
    const settingsByProblemId = new Map(problemSettings.map((setting) => [setting.problemId, setting]));
    // parsed problemIds available

    // Validate that all problems exist and belong to the specified course
    const validProblems = (await prisma.problem.findMany({
      where: {
        id: { in: problemIds },
        courseId,
      },
      select: { id: true },
    })) as Id[];

    const validIds = validProblems.map((p: (typeof validProblems)[number]) => p.id);

    // Get existing assignment-problem links
    const existingLinks = (await prisma.assignmentProblem.findMany({
      where: {
        assignmentId,
        assignment: {
          courseId,
        },
      },
      include: {
        _count: {
          select: {
            submissions: true,
          },
        },
      },
    })) as AssignmentProblemCount[];

    // Separate links with submissions (for reporting only)
    const linksWithSubmissions = existingLinks.filter(
      (link: (typeof existingLinks)[number]) => link._count.submissions > 0,
    );
    const existingProblemIds = existingLinks.map(
      (link: (typeof existingLinks)[number]) => link.problemId,
    );

    // Add new links for problems that aren't already linked
    const newProblemIds = validIds.filter(
      (pid: string) => !existingProblemIds.includes(pid),
    ) as string[];

    if (newProblemIds.length > 0) {
      await prisma.assignmentProblem.createMany({
        data: newProblemIds.map((pid: string) => {
          const config = settingsByProblemId.get(pid);
          const resolvedMaxSubmissions =
            config?.maxSubmissions === -1
              ? -1
              : Math.max(1, config?.maxSubmissions ?? 1);

          return {
            assignmentId,
            problemId: pid,
            maxPoints: config?.maxPoints ?? 0,
            maxSubmissions: resolvedMaxSubmissions,
            autograderEnabled: config?.autograderEnabled ?? true,
          };
        }),
      });
    }

    // Final set includes all existing problems + new problems
    const finalProblemIds = [...existingProblemIds, ...newProblemIds];

    // Fetch the updated assignment with its problems
    const updated = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        problems: {
          include: { problem: true },
        },
      },
    });

    const problems =
      updated?.problems.map((ap: NonNullable<typeof updated>['problems'][number]) => ap.problem) ||
      [];

    // Log the action to the ActivityLog
    try {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_ASSIGNMENT_PROBLEMS',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId,
        metadata: {
          userId: user.id,
          courseId: courseId,
          assignmentId: assignmentId,
          addedProblemIds: newProblemIds,
          protectedProblemIds: linksWithSubmissions.map(
            (link: (typeof linksWithSubmissions)[number]) => link.problemId,
          ),
          finalProblemIds: finalProblemIds,
          linksWithSubmissions: linksWithSubmissions.length,
        },
      });
    } catch (logError) {
      console.warn('Failed to log activity:', logError);
      // Don't fail the whole request if logging fails
    }

    // Respond with the updated problem list and information about protected problems
    const response = {
      success: true,
      problems,
      metadata: {
        totalProblems: problems.length,
        newProblemsAdded: newProblemIds.length,
        protectedProblems: linksWithSubmissions.length,
        message:
          linksWithSubmissions.length > 0
            ? `Added ${newProblemIds.length} new problems. ${linksWithSubmissions.length} existing problems with submissions were preserved.`
            : `Successfully updated assignment with ${finalProblemIds.length} problems.`,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    // Handle unexpected errors
    console.error('Failed to update assignment problems:', err);
    return NextResponse.json({ error: 'Failed to update assignment problems.' }, { status: 500 });
  }
}
