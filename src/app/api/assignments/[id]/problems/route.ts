import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/app/utils/jwt';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  const decoded = token ? verifyToken(token) : null;

  if (!decoded) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const assignmentProblems = await prisma.assignmentProblem.findMany({
      where: { assignmentId: id },
      include: {
        problem: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            maxStates: true,
            isDeterministic: true,
          },
        },
      },
      orderBy: { problemId: 'asc' },
    });

    const problems = assignmentProblems.map((ap) => ap.problem);

    return NextResponse.json(problems);
  } catch (error) {
    console.error('API GET PROBLEMS error:', error);
    return NextResponse.json({ error: 'Failed to fetch problems.' }, { status: 500 });
  }
}
