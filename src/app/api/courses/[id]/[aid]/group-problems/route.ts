import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET(_: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const { id: courseId, aid: assignmentId } = await params;

  try {
    const session = await auth();
    const user = session?.user;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

    // Fetch groups for the course and their assignment problem mappings
    const groups = await prisma.group.findMany({ where: { courseId }, select: { id: true, name: true } });

    // Fetch groupAssignmentProblem rows for this assignment
    const mappings = await prisma.groupAssignmentProblem.findMany({ where: { assignmentId } });

    const mapByGroup: Record<string, string[]> = {};
    for (const m of mappings) {
      if (!mapByGroup[m.groupId]) mapByGroup[m.groupId] = [];
      mapByGroup[m.groupId].push(m.problemId);
    }

    const result = groups.map((g) => ({ id: g.id, name: g.name, problemIds: mapByGroup[g.id] ?? [] }));

    return NextResponse.json({ success: true, groups: result });
  } catch (err) {
    console.error('Failed to fetch group problems:', err);
    return NextResponse.json({ error: 'Failed to fetch group problems' }, { status: 500 });
  }
}

// DELETE: remove group->problem mappings for an assignment
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const { id: courseId, aid: assignmentId } = await params;

  try {
    const session = await auth();
    const user = session?.user;
    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    let body;
    try {
      const text = await req.text();
      if (!text || text.trim() === '') {
        return NextResponse.json({ error: 'Empty request body' }, { status: 400 });
      }
      body = JSON.parse(text);
    } catch (parseErr) {
      console.error('Invalid JSON in DELETE /group-problems:', parseErr);
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const problemIds: string[] = Array.isArray(body.problemIds) ? body.problemIds : [];
    const groupId: string | undefined = typeof body.groupId === 'string' ? body.groupId : undefined;

    if (problemIds.length === 0) {
      return NextResponse.json({ error: 'No problemIds provided' }, { status: 400 });
    }

    // If a specific group is requested, ensure it belongs to the course
    if (groupId && groupId !== 'ALL') {
      const group = await prisma.group.findUnique({ where: { id: groupId } });
      if (!group || group.courseId !== courseId) {
        return NextResponse.json({ error: 'Invalid group' }, { status: 400 });
      }
    }

    if (groupId === 'ALL') {
      // Remove all mappings for these problems in this assignment
      await prisma.groupAssignmentProblem.deleteMany({ where: { assignmentId, problemId: { in: problemIds } } });
    } else if (groupId) {
      // Remove mappings for the specific group
      await prisma.groupAssignmentProblem.deleteMany({ where: { assignmentId, problemId: { in: problemIds }, groupId } });
    } else {
      // No group specified - ambiguous
      return NextResponse.json({ error: 'groupId is required for DELETE' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete group problems:', err);
    return NextResponse.json({ error: 'Failed to delete group problems' }, { status: 500 });
  }
}
