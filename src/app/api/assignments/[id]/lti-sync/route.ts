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
 * `userId` asks for one student's own grade alongside the assignment's totals. Nothing is
 * disclosed by it that the caller cannot already see: they manage the course, and the answer
 * only ever concerns this assignment.
 *
 * @openapi
 * summary: How this assignment's grades are syncing to the LMS
 * parameters:
 *   - { in: query, name: userId, schema: { type: string }, description: "Also report this student's own grade." }
 * responses:
 *   200:
 *     description: Sync state for the assignment, and for the one student when asked.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             linked: { type: boolean, description: Whether the course opens from any LMS. }
 *             autoSync: { type: boolean }
 *             pending: { type: number }
 *             sent: { type: number }
 *             failed: { type: number }
 *             lastSentAt: { type: string, nullable: true }
 *             student:
 *               type: object
 *               nullable: true
 *               description: "Where the named student's own grade has got to, with the reason it failed when it did."
 *               properties:
 *                 state: { type: string, enum: [PENDING, SENT, FAILED] }
 *                 sentAt: { type: string, nullable: true }
 *                 lastError: { type: string, nullable: true }
 *   401: { description: Not signed in. }
 *   403: { description: You do not manage this course. }
 *   404: { description: No such assignment. }
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await staffFor(id);
  if (!gate.ok) return gate.response;

  const userId = new URL(request.url).searchParams.get('userId')?.trim() || undefined;
  const state = await assignmentSyncState(id, userId);
  if (!state) return apiError(404, 'Not found');

  return NextResponse.json(state);
}

const PatchSchema = z.object({ autoSync: z.boolean() });

/**
 * @openapi
 * summary: Turn automatic grade sync on or off for this assignment
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [autoSync]
 *         properties:
 *           autoSync: { type: boolean, description: "On: grades go to the LMS as they change. Off: nothing is sent until asked." }
 * responses:
 *   200: { description: Saved. }
 *   401: { description: Not signed in. }
 *   403: { description: You do not manage this course. }
 *   404: { description: No such assignment. }
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

const PostSchema = z.object({ userId: z.string().trim().min(1).optional() });

/**
 * Queue every grade that has changed since it was last sent, or one student's.
 *
 * Queues rather than sends: the sender delivers them, so a slow LMS cannot make this request
 * hang or fail.
 *
 * `userId` is what the panel beside one student's work sends. Without it every outstanding
 * grade for the assignment goes, which is the retry-everything button faculty need after an
 * LMS outage.
 * @openapi
 * summary: Send this assignment's grades to the LMS
 * description: >-
 *   Queues rather than sends, so a slow LMS cannot make the request hang: the background sender
 *   delivers what is queued. This is also the one place a grade that has given up is retried.
 * requestBody:
 *   required: false
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           userId: { type: string, description: "Send only this student's grade. Without a body, every outstanding grade for the assignment goes." }
 * responses:
 *   200:
 *     description: How many grades were queued.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { queued: { type: number } } }
 *   400: { description: The body was malformed. }
 *   401: { description: Not signed in. }
 *   403: { description: You do not manage this course. }
 *   404: { description: No such assignment. }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await staffFor(id);
  if (!gate.ok) return gate.response;

  // A body is optional here: sending everything is the older call and still sends none.
  const raw = await request.text();
  let userId: string | undefined;
  if (raw.trim()) {
    let parsed;
    try {
      parsed = PostSchema.safeParse(JSON.parse(raw));
    } catch {
      return apiError(400, 'Invalid JSON body');
    }
    if (!parsed.success) return apiError(400, 'Invalid request body');
    userId = parsed.data.userId;
  }

  // Deliberate, so this is the one place a failed grade is tried again.
  const queued = await queueChangedGrades(id, { retryFailed: true, userId });

  return NextResponse.json({ queued });
}
