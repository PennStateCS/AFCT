import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { canManageCourse } from '@/lib/permissions';
import { buildDeepLinkResponse, deepLinkReturnHtml } from '@/lib/lti/deep-link';
import { publicUrl } from '@/lib/lti/public-url';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

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

/**
 * @openapi
 * summary: Return a chosen assignment to the LMS as a deep link
 * responses:
 *   200: { description: A page that posts the signed response back to the LMS. }
 *   400: { description: The request has expired or is not yours. }
 *   403: { description: You do not run that course. }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return page(message('Not signed in', 'Open the link from your LMS again.'), 401);
  }

  const form = await request.formData();
  const pendingId = form.get('pendingId');
  const assignmentId = form.get('assignmentId');
  if (typeof pendingId !== 'string' || typeof assignmentId !== 'string') {
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

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, title: true, courseId: true, problems: { select: { maxPoints: true } } },
  });
  if (!assignment) {
    return page(message('That assignment is gone', 'Go back and choose another.'), 400);
  }

  // Checked again here, not only on the page: a form can be posted directly, and without this
  // a deep link would be a way to attach somebody else's assignment to your own LMS course.
  if (!(await canManageCourse(session.user, assignment.courseId))) {
    return page(
      message('You cannot choose that', 'Only the people who run that course can link it.'),
      403,
    );
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
