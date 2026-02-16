import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function triangular(min: number, mode: number, max: number) {
  const u = Math.random();
  const c = (mode - min) / (max - min || 1);
  if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; aid: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['FACULTY', 'TA', 'ADMIN'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const resolved = await params;
    const courseId = resolved.id;
    const assignmentId = resolved.aid;

    const body = await req.json();
    const { lowPoints, meanPoints, highPoints } = body as { lowPoints: number; meanPoints: number; highPoints: number };

    if (typeof lowPoints !== 'number' || typeof meanPoints !== 'number' || typeof highPoints !== 'number') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Fetch assignment
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    const maxPoints = assignment.maxPoints;
    if (typeof maxPoints !== 'number' || maxPoints <= 0) return NextResponse.json({ error: 'Invalid assignment max points' }, { status: 400 });

    if (!(lowPoints >= 0 && meanPoints >= lowPoints && highPoints >= meanPoints && highPoints <= maxPoints)) {
      return NextResponse.json({ error: `Ensure 0 ≤ low ≤ mean ≤ high ≤ ${maxPoints}` }, { status: 400 });
    }

    // Fetch course students (roster entries with CourseRole.STUDENT)
    const rosterEntries = await prisma.roster.findMany({ where: { courseId, role: 'STUDENT' } });
    const studentIds = rosterEntries.map((r) => r.userId);

    const N = studentIds.length;
    let updated = 0;

    if (N > 0) {
      const min = lowPoints;
      const mode = meanPoints;
      const max = highPoints;
      const roundQuarter = (v: number) => Math.round(v * 4) / 4;

      // Target sum and bounds
      const targetSum = roundQuarter(N * meanPoints);

      // Initial samples from triangular distribution
      const samples: number[] = [];
      for (let i = 0; i < N; i++) {
        samples.push(roundQuarter(triangular(min, mode, max)));
      }

      // Iteratively redistribute to make the sum equal to targetSum, respecting bounds
      let currSum = samples.reduce((s, a) => s + a, 0);
      let diff = targetSum - currSum;
      let iter = 0;
      while (Math.abs(diff) > 1e-8 && iter < 1000) {
        const adjustableIdx = samples
          .map((v, i) => i)
          .filter((i) => samples[i] > min + 1e-9 && samples[i] < max - 1e-9);
        if (adjustableIdx.length === 0) break;
        const per = diff / adjustableIdx.length;
        let changed = false;
        for (const i of adjustableIdx) {
          const nv = roundQuarter(Math.max(min, Math.min(max, samples[i] + per)));
          if (nv !== samples[i]) {
            samples[i] = nv;
            changed = true;
          }
        }
        currSum = samples.reduce((s, a) => s + a, 0);
        diff = targetSum - currSum;
        if (!changed) break;
        iter++;
      }

      // Fix any remaining residual in quarter steps
      let residualSteps = Math.round((targetSum - currSum) * 4);
      let attempts = 0;
      while (residualSteps !== 0 && attempts < N * 10) {
        if (residualSteps > 0) {
          const idx = samples.findIndex((v) => v + 0.25 <= max);
          if (idx === -1) break;
          samples[idx] = roundQuarter(samples[idx] + 0.25);
          residualSteps -= 1;
        } else {
          const idx = samples.findIndex((v) => v - 0.25 >= min);
          if (idx === -1) break;
          samples[idx] = roundQuarter(samples[idx] - 0.25);
          residualSteps += 1;
        }
        attempts++;
      }

      currSum = samples.reduce((s, a) => s + a, 0);
      if (Math.abs(currSum - targetSum) > 0.001) {
        console.warn(`Could not exactly match target mean; residual ${(targetSum - currSum).toFixed(4)}`);
      }

      // Shuffle assignments to students so ordering doesn't bias who gets which sample
      const shuffledIds = studentIds.slice();
      for (let i = shuffledIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledIds[i], shuffledIds[j]] = [shuffledIds[j], shuffledIds[i]];
      }

      // Persist upserts
      for (let i = 0; i < N; i++) {
        const sid = shuffledIds[i];
        const sampled = samples[i];
        /* eslint-disable @typescript-eslint/no-explicit-any */
        await (prisma as any).assignmentGrade.upsert({
          where: { assignmentId_studentId: { assignmentId, studentId: sid } },
          create: { assignmentId, studentId: sid, grade: sampled, feedback: null },
          update: { grade: sampled },
        });
        updated++;
      }
    }

    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error('POST /api/courses/[id]/assignments/[aid]/random-grades error:', error);
    return NextResponse.json({ error: 'Failed to apply random grades' }, { status: 500 });
  }
}
