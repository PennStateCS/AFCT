import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { readJson } from '@/lib/api/request';
import { apiError } from '@/lib/api/http';
import { canManageCourse } from '@/lib/permissions';
import { assignmentSyncState, queueChangedGrades } from '@/lib/lti/grade-sync';

/** Whether the caller runs the course this assignment belongs to. */
async function staffFor(assignmentId: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, response: apiError(401, 'Not signed in') };

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { courseId: true },
  });
  if (!assignment) return { ok: false as const, response: apiError(404, 'Not found') };

  const allowed = await canManageCourse(session.user, assignment.courseId);
  if (!allowed) return { ok: false as const, response: apiError(403, 'Forbidden') };

  return { ok: true as const, courseId: assignment.courseId };
}

/**
 * @openapi
 * summary: How this assignment's grades are syncing to the LMS
 * responses:
 *   200: { description: Sync state for the assignment. }
 *   403: { description: You do not manage this course. }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await staffFor(id);
  if (!gate.ok) return gate.response;

  const state = await assignmentSyncState(id);
  if (!state) return apiError(404, 'Not found');

  return NextResponse.json(state);
}

const PatchSchema = z.object({ autoSync: z.boolean() });

/**
 * @openapi
 * summary: Turn automatic grade sync on or off for this assignment
 * responses:
 *   200: { description: Saved. }
 *   403: { description: You do not manage this course. }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await staffFor(id);
  if (!gate.ok) return gate.response;

  const body = await readJson(request, PatchSchema);
  if (!body.ok) return body.response;

  await prisma.assignment.update({
    where: { id },
    data: { ltiAutoSync: body.data.autoSync },
  });

  return NextResponse.json({ autoSync: body.data.autoSync });
}

/**
 * Queue every grade that has changed since it was last sent.
 *
 * Queues rather than sends: the sender delivers them, so a slow LMS cannot make this request
 * hang or fail.
 * @openapi
 * summary: Send this assignment's grades to the LMS
 * responses:
 *   200: { description: How many grades were queued. }
 *   403: { description: You do not manage this course. }
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await staffFor(id);
  if (!gate.ok) return gate.response;

  // Deliberate, so this is the one place a failed grade is tried again.
  const queued = await queueChangedGrades(id, { retryFailed: true });

  return NextResponse.json({ queued });
}
