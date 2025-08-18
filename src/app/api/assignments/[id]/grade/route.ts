import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const assignmentId = params.id;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    // Verify user is either requesting their own grade or is faculty/admin/TA
    if (userId && userId !== session.user.id && 
        session.user.role !== 'FACULTY' && 
        session.user.role !== 'ADMIN' && 
        session.user.role !== 'TA') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If no userId specified, use the current user's ID
    const targetUserId = userId || session.user.id;

    // Calculate the total grade for the assignment by summing all problem grades
    const submissions = await prisma.submission.findMany({
      where: {
        studentId: targetUserId,
        problem: {
          assignments: {
            some: {
              assignmentId: assignmentId,
            },
          },
        },
      },
      include: {
        problem: {
          include: {
            assignments: {
              where: {
                assignmentId: assignmentId,
              },
            },
          },
        },
      },
    });

    // Get the best grade for each problem (in case of multiple submissions)
    const problemGrades = new Map<string, number>();
    
    submissions.forEach(submission => {
      if (submission.grade !== null) {
        const currentGrade = problemGrades.get(submission.problemId) || 0;
        if (submission.grade > currentGrade) {
          problemGrades.set(submission.problemId, submission.grade);
        }
      }
    });

    // Sum up all problem grades
    const totalGrade = Array.from(problemGrades.values()).reduce((sum, grade) => sum + grade, 0);

    return NextResponse.json({ 
      grade: totalGrade > 0 ? totalGrade : null,
      problemGrades: Object.fromEntries(problemGrades),
    });
  } catch (error) {
    console.error('Error fetching assignment grade:', error);
    return NextResponse.json(
      { error: 'Failed to fetch assignment grade' },
      { status: 500 }
    );
  }
}
