import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { readJson } from '@/lib/api/request';
import { apiError } from '@/lib/api/http';
import { logDenial, safeAuditLog } from '@/lib/api/activity';
import { canManageCourse } from '@/lib/permissions';
import { assignmentSyncState, queueChangedGrades } from '@/lib/lti/grade-sync';

/**
 * Whether the caller runs the course this assignment belongs to.
 *
 * Hand-rolled rather than `withAssignmentAuth` because this path has no course segment and that
 * wrapper reads the course from a route param. It borrows the part that matters: a refusal is
 * logged, where this used to return a bare 403.
 *
 * Returns the sync flag too, so a caller changing it has a `from` value without a second read.
 */
async function staffFor(assignmentId: string, req: Request) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, response: apiError(401, 'Not signed in') };

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { courseId: true, ltiAutoSync: true },
  });
  if (!assignment) return { ok: false as const, response: apiError(404, 'Not found') };

  const allowed = await canManageCourse(session.user, assignment.courseId);
  if (!allowed) {
    return {
      ok: false as const,
      response: await logDenial(req, {
        userId: session.user.id,
        action: 'ASSIGNMENT_GRADE_SYNC_DENIED',
        category: 'GRADE',
        courseId: assignment.courseId,
        assignmentId,
        metadata: { reason: 'does not manage this course' },
      }),
    };
  }

  return {
    ok: true as const,
    courseId: assignment.courseId,
    userId: session.user.id,
    autoSync: assignment.ltiAutoSync,
  };
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
  const gate = await staffFor(id, request);
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
  const gate = await staffFor(id, request);
  if (!gate.ok) return gate.response;

  const body = await readJson(request, PatchSchema);
  if (!body.ok) return body.response;

  const from = gate.autoSync;
  const to = body.data.autoSync;

  await prisma.assignment.update({
    where: { id },
    data: { ltiAutoSync: to },
  });

  /**
   * This decides whether grades reach the LMS, and wrote nothing before: "when did this get
   * turned off, and by whom" had no answer.
   *
   * A save that changed nothing logs nothing, since the toggle sends its state rather than a
   * difference and a refresh would otherwise look like an event.
   */
  if (from !== to) {
    await safeAuditLog('ASSIGNMENT_GRADE_SYNC_UPDATED', request, {
      userId: gate.userId,
      action: 'ASSIGNMENT_GRADE_SYNC_UPDATED',
      severity: 'INFO',
      // Explicitly GRADE: the action name contains both "assignment" and "grade", and what
      // this changes is whether grades leave AFCT.
      category: 'GRADE',
      courseId: gate.courseId,
      assignmentId: id,
      metadata: { changes: { autoSync: { from, to } } },
    });
  }

  return NextResponse.json({ autoSync: to });
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
  const gate = await staffFor(id, request);
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

  /**
   * The person who asked. Each queued grade writes its own LTI_SCORE_QUEUED entry, but nothing
   * said a human pressed the button or which assignment it was for.
   *
   * `targetUserId` for a single student: sending a grade to the LMS puts an education record
   * outside AFCT, and a disclosure about one person names them.
   */
  await safeAuditLog('LTI_GRADES_PUSH_REQUESTED', request, {
    userId: gate.userId,
    action: 'LTI_GRADES_PUSH_REQUESTED',
    severity: 'INFO',
    category: 'GRADE',
    courseId: gate.courseId,
    assignmentId: id,
    metadata: {
      queued,
      scope: userId ? 'student' : 'assignment',
      ...(userId ? { targetUserId: userId } : {}),
    },
  });

  return NextResponse.json({ queued });
}
