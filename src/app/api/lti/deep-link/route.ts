import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { canManageCourse } from '@/lib/permissions';
import { buildDeepLinkResponse, deepLinkReturnHtml } from '@/lib/lti/deep-link';
import { publicUrl } from '@/lib/lti/public-url';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { resolveCourseTimezone } from '@/lib/course-timezone';
import { toEndOfDayInTimezone } from '@/lib/date-convert';
import { resolveUnlockAt } from '@/lib/assignment-late-window';

/**
 * Take the chosen assignment and hand back the page that returns it to the LMS.
 *
 * Everything the platform sees comes from the stored request, never from this form: the return
 * URL and the platform's state are read from the pending row, and only which assignment was
 * chosen is taken from the browser. AFCT signs what it sends, so where it sends it is not a
 * caller's decision.
 */

function page(html: string, status = 200) {
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** A plain page for the cases where there is nothing to return to the LMS. */
const message = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body><h1>${title}</h1><p>${body}</p></body></html>`;

type NewAssignment = {
  id: string;
  title: string;
  courseId: string;
  problems: { maxPoints: number | null }[];
};

/**
 * Create the assignment the faculty member described, so a link can be made to something that
 * did not exist a moment ago.
 *
 * Deliberately the smallest assignment AFCT will accept: a title, a due date, an optional
 * available-from date. Problems, points, audience and late policy are all left at their
 * defaults, because this runs inside a modal in somebody else's software while they are in the
 * middle of building an LMS assignment, and every extra field there is a field they cannot see
 * the rest of the form behind. Everything is editable in AFCT afterwards.
 *
 * Dates are read in the course's timezone through the same helpers the assignment API uses, so
 * a date typed here means the same day it would mean anywhere else in AFCT.
 *
 * Returns a reason string instead of throwing when the input is unusable, so the caller can
 * send the person back to the form rather than to an error page.
 */
async function createAssignment(opts: {
  form: FormData;
  courseId: string;
  userId: string;
  request: Request;
}): Promise<NewAssignment | 'missing-title' | 'bad-dates'> {
  const title = String(opts.form.get('title') ?? '').trim();
  const due = String(opts.form.get('dueDate') ?? '').trim();
  const unlock = String(opts.form.get('unlockAt') ?? '').trim();
  if (!title || title.length > 200 || !due) return 'missing-title';

  const timezone = await resolveCourseTimezone(opts.courseId);
  const dueDate = toEndOfDayInTimezone(due, timezone);
  if (Number.isNaN(dueDate.getTime())) return 'bad-dates';

  const unlockState = resolveUnlockAt({
    incoming: unlock || null,
    existing: null,
    dueDate,
    timezone,
  });
  if (!unlockState.ok) return 'bad-dates';

  const created = await prisma.assignment.create({
    data: {
      courseId: opts.courseId,
      title,
      dueDate,
      unlockAt: unlockState.unlockAt,
      isPublished: opts.form.get('isPublished') === 'on',
    },
    select: { id: true, title: true, courseId: true, problems: { select: { maxPoints: true } } },
  });

  // The same action a hand-made assignment records, so the log reads as one kind of event
  // however it happened, with `via` saying which door it came through.
  await createEnhancedActivityLog(prisma, opts.request, {
    userId: opts.userId,
    courseId: opts.courseId,
    assignmentId: created.id,
    action: 'CREATE_ASSIGNMENT',
    severity: 'INFO',
    category: 'COURSE',
    metadata: { title: created.title, via: 'lti-deep-link' },
  });

  return created;
}

/**
 * @openapi
 * summary: Return a chosen assignment to the LMS as a deep link
 * description: >-
 *   Where the deep-linking picker posts its choice. The return address and the platform's own
 *   state come from the pending request the launch stored, never from this form; only which
 *   assignment was chosen (or the fields of a new one) is taken from the browser. The answer is
 *   a small page that posts the signed deep-linking response back to the LMS.
 * requestBody:
 *   required: true
 *   content:
 *     application/x-www-form-urlencoded:
 *       schema:
 *         type: object
 *         required: [pendingId]
 *         properties:
 *           pendingId: { type: string, description: The pending deep-linking request the launch stored. }
 *           mode: { type: string, enum: [connect, create], description: "Link an existing assignment, or create one to link. Defaults to connect." }
 *           assignmentId: { type: string, description: The assignment to link (connect mode). }
 *           title: { type: string, description: The new assignment's title (create mode). }
 *           dueDate: { type: string, description: "The new assignment's due date, a date in the course's timezone (create mode)." }
 *           unlockAt: { type: string, description: When the new assignment opens (create mode). }
 *           isPublished: { type: string, enum: ['on'], description: Publish the new assignment immediately (create mode). }
 * responses:
 *   200: { description: A page that posts the signed response back to the LMS. }
 *   303: { description: "Back to the picker with something to fix: a missing title, bad dates, or an assignment already linked." }
 *   400: { description: "The pending request has expired, the course is not connected, or the placement does not accept assignment links." }
 *   401: { description: Not signed in. }
 *   403: { description: "You do not run that course, or the assignment belongs to a different one." }
 *   500: { description: AFCT has no signing key. }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return page(message('Not signed in', 'Open the link from your LMS again.'), 401);
  }

  const form = await request.formData();
  const pendingId = form.get('pendingId');
  const mode = form.get('mode') === 'create' ? 'create' : 'connect';
  const assignmentId = form.get('assignmentId');
  if (typeof pendingId !== 'string') {
    return page(message('Something was missing', 'Go back and choose an assignment.'), 400);
  }
  if (mode === 'connect' && typeof assignmentId !== 'string') {
    return page(message('Something was missing', 'Go back and choose an assignment.'), 400);
  }

  const pending = await prisma.ltiPendingDeepLink.findFirst({
    where: { id: pendingId, userId: session.user.id, expiresAt: { gt: new Date() } },
    include: {
      platform: { select: { issuer: true, clientId: true, deploymentId: true } },
    },
  });
  if (!pending) {
    return page(
      message('This request has expired', 'Go back to your LMS and add the AFCT link again.'),
      400,
    );
  }

  /**
   * Which AFCT course this LMS course opens into.
   *
   * Needed by both paths and looked up from the pending row rather than the form: a new
   * assignment has to be created in the right course, and an existing one has to be checked
   * against it.
   */
  const contextLink = pending.contextId
    ? await prisma.ltiContextLink.findUnique({
        where: {
          platformId_contextId: { platformId: pending.platformId, contextId: pending.contextId },
        },
        select: { id: true, courseId: true },
      })
    : null;
  if (!contextLink) {
    return page(
      message(
        'This course is not connected yet',
        'Open the AFCT link from this course once and choose the course, then add an assignment link.',
      ),
      400,
    );
  }

  // Checked here, not only on the page: a form can be posted directly, and without this a deep
  // link would be a way to attach somebody else's assignment to your own LMS course.
  if (!(await canManageCourse(session.user, contextLink.courseId))) {
    return page(
      message('You cannot choose that', 'Only the people who run that course can link it.'),
      403,
    );
  }

  /** Back to the picker with something to fix, rather than a dead end. */
  const backToPicker = (reason: string, step: 'create' | 'connect') =>
    NextResponse.redirect(
      publicUrl(
        `/lti/deep-link?pending=${encodeURIComponent(pending.id)}&mode=${step}&error=${reason}`,
        request,
      ),
      303,
    );

  const assignment =
    mode === 'create'
      ? await createAssignment({
          form,
          courseId: contextLink.courseId,
          userId: session.user.id,
          request,
        })
      : await prisma.assignment.findUnique({
          where: { id: assignmentId as string },
          select: {
            id: true,
            title: true,
            courseId: true,
            problems: { select: { maxPoints: true } },
          },
        });

  if (assignment === 'missing-title' || assignment === 'bad-dates') {
    return backToPicker(assignment, 'create');
  }
  if (!assignment) {
    return page(message('That assignment is gone', 'Go back and choose another.'), 400);
  }

  /**
   * The assignment has to belong to the course this LMS course opens into.
   *
   * Not merely to a course the person runs: somebody who teaches two courses could otherwise
   * attach an assignment from one to the other's LMS course, and every grade for it would then
   * be posted into a gradebook it has nothing to do with.
   */
  if (assignment.courseId !== contextLink.courseId) {
    return page(
      message(
        'You cannot choose that',
        'That assignment belongs to a different course from the one this LMS course opens.',
      ),
      403,
    );
  }

  /**
   * One link per assignment per LMS course, enforced by the unique index rather than by a
   * check: two submissions of the same form would both pass a check. A second attempt is not
   * an error worth a dead end, so it goes back to the picker saying what happened.
   */
  try {
    await prisma.ltiDeepLink.create({
      data: {
        contextLinkId: contextLink.id,
        assignmentId: assignment.id,
        createdByUserId: session.user.id,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return backToPicker('already-linked', 'connect');
    }
    throw error;
  }

  const scoreMaximum = assignment.problems.reduce((sum, p) => sum + Number(p.maxPoints ?? 0), 0);

  const response = await buildDeepLinkResponse({
    platform: pending.platform,
    returnUrl: pending.returnUrl,
    data: pending.data,
    // AFCT returns one assignment per deep linking response. `pending.acceptMultiple` records
    // whether the platform would take several, and is preserved for future multi-selection
    // support rather than read here: it permits more than one, it does not ask for more than one.
    items: [
      {
        // Where the platform sends people. The launch endpoint, as always: the assignment is
        // carried in the link's own custom claim rather than in the URL.
        url: publicUrl('/api/lti/launch', request),
        title: assignment.title,
        scoreMaximum: scoreMaximum > 0 ? scoreMaximum : null,
        assignmentId: assignment.id,
      },
    ],
    acceptTypes: pending.acceptTypes,
    acceptLineItem: pending.acceptLineItem,
    // What the platform said it would display, so AFCT does not answer with a target it was
    // never offered.
    acceptPresentationDocumentTargets: pending.acceptPresentationDocumentTargets,
  });

  if (!response.ok) {
    // Two different problems, and an administrator can only act on one of them.
    if (response.reason === 'type-not-accepted') {
      return page(
        message(
          'Your LMS will not take an assignment link here',
          'This placement accepts other kinds of content. Add the AFCT link from a place that takes an external tool link, such as an assignment or a module item.',
        ),
        400,
      );
    }
    return page(
      message(
        'AFCT could not sign the response',
        'It has no signing key. Ask an administrator to check the LTI registration.',
      ),
      500,
    );
  }

  await prisma.ltiPendingDeepLink.delete({ where: { id: pending.id } });

  await createEnhancedActivityLog(prisma, request, {
    userId: session.user.id,
    courseId: assignment.courseId,
    assignmentId: assignment.id,
    action: 'LTI_DEEP_LINK_RETURNED',
    severity: 'INFO',
    category: 'COURSE',
    metadata: { issuer: pending.platform.issuer, assignmentTitle: assignment.title },
  });

  // The nonce the edge set for this request, or the script that submits the form is blocked.
  const nonce = request.headers.get('x-nonce');
  return page(deepLinkReturnHtml(response.returnUrl, response.jwt, nonce));
}
