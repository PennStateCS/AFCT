/**
 * Which LMS courses know about an AFCT course or assignment, for the screens that say so.
 *
 * Staff kept asking a question AFCT could answer and did not: "is this already in Canvas?".
 * Nothing on the course or the assignment showed it, so the only way to find out was to open
 * the LMS and look, and the picker's refusal to add the same assignment twice arrived as a
 * surprise rather than as a reminder.
 *
 * Two different records answer it, which is why there are two functions rather than one.
 * A course is linked by `LtiContextLink`, written the first time somebody launches from an LMS
 * course and chooses which AFCT course it is. An assignment is linked by `LtiDeepLink`, written
 * when it is added to that LMS course through the picker. A course can be linked without any
 * assignment being linked, and that is the normal state right after a course is connected.
 */

import { prisma } from '@/lib/prisma';
import { platformLabel, type LmsLinkSummary } from '@/lib/lti/link-labels';

export type { LmsLinkSummary };

export type CourseLmsLink = {
  platform: string;
  context: string | null;
};

/** Every LMS course this assignment has been added to. */
export async function assignmentLmsLinks(assignmentId: string): Promise<LmsLinkSummary[]> {
  const links = await prisma.ltiDeepLink.findMany({
    where: { assignmentId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdAt: true,
      createdBy: { select: { firstName: true, lastName: true } },
      contextLink: {
        select: {
          contextTitle: true,
          platform: { select: { name: true, issuer: true } },
        },
      },
    },
  });

  return links.map((link) => ({
    id: link.id,
    platform: platformLabel(link.contextLink.platform),
    context: link.contextLink.contextTitle,
    addedAt: link.createdAt,
    addedBy: link.createdBy
      ? `${link.createdBy.firstName ?? ''} ${link.createdBy.lastName ?? ''}`.trim() || null
      : null,
  }));
}

/** Every LMS course connected to this AFCT course. */
export async function courseLmsLinks(courseId: string): Promise<CourseLmsLink[]> {
  const links = await prisma.ltiContextLink.findMany({
    where: { courseId },
    orderBy: { createdAt: 'asc' },
    select: {
      contextTitle: true,
      platform: { select: { name: true, issuer: true } },
    },
  });

  return links.map((link) => ({
    platform: platformLabel(link.platform),
    context: link.contextTitle,
  }));
}
