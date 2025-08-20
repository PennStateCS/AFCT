// /src/api/courses/[id]/[aid]/add-problems/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

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
      console.log('Request body text:', requestText);
      
      if (!requestText || requestText.trim() === '') {
        console.log('Empty request body');
        return NextResponse.json({ error: 'Empty request body' }, { status: 400 });
      }
      
      body = JSON.parse(requestText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const problemIds: string[] = Array.isArray(body.problemIds) ? body.problemIds : [];
    console.log('Parsed problemIds:', problemIds);

    // Validate that all problems exist and belong to the specified course
    const validProblems = await prisma.problem.findMany({
      where: {
        id: { in: problemIds },
        courseId,
      },
      select: { id: true },
    });

    const validIds = validProblems.map((p) => p.id);

    // Get existing assignment-problem links
    const existingLinks = await prisma.assignmentProblem.findMany({
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
    });

    // Separate links with and without submissions
    const linksWithSubmissions = existingLinks.filter(link => link._count.submissions > 0);
    const linksWithoutSubmissions = existingLinks.filter(link => link._count.submissions === 0);
    const existingProblemIds = existingLinks.map(link => link.problemId);

    // Only remove links that have no submissions
    if (linksWithoutSubmissions.length > 0) {
      await prisma.assignmentProblem.deleteMany({
        where: {
          assignmentId,
          problemId: {
            in: linksWithoutSubmissions.map(link => link.problemId),
          },
        },
      });
    }

    // Keep existing problem IDs that have submissions
    const protectedProblemIds = linksWithSubmissions.map(link => link.problemId);
    
    // Add new links for problems that aren't already linked
    const newProblemIds = validIds.filter(id => !existingProblemIds.includes(id));
    
    if (newProblemIds.length > 0) {
      await prisma.assignmentProblem.createMany({
        data: newProblemIds.map((pid) => ({
          assignmentId,
          problemId: pid,
        })),
      });
    }

    // Final set includes protected problems + new problems
    const finalProblemIds = [...protectedProblemIds, ...newProblemIds];

    // Fetch the updated assignment with its problems
    const updated = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        problems: {
          include: { problem: true },
        },
      },
    });

    const problems = updated?.problems.map((ap) => ap.problem) || [];

    // Log the action to the ActivityLog
    try {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_ASSIGNMENT_PROBLEMS',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId,
        metadata: {
          addedProblemIds: newProblemIds,
          protectedProblemIds: protectedProblemIds,
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
        protectedProblems: protectedProblemIds.length,
        message: protectedProblemIds.length > 0 
          ? `Added ${newProblemIds.length} new problems. ${protectedProblemIds.length} existing problems with submissions were preserved.`
          : `Successfully updated assignment with ${finalProblemIds.length} problems.`
      }
    };

    return NextResponse.json(response);
  } catch (err) {
    // Handle unexpected errors
    console.error('Failed to update assignment problems:', err);
    return NextResponse.json({ error: 'Failed to update assignment problems.' }, { status: 500 });
  }
}
