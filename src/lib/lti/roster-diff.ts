/**
 * Comparing an LMS roster against AFCT's own.
 *
 * Works out what *would* change and changes nothing. Roster sync decides who can read student
 * work, so the difference is shown to a person before it is applied rather than happening on a
 * timer.
 *
 * Two rules shape every decision here:
 *
 *  - **Nobody is deleted.** A student the LMS no longer lists is marked dropped, which is what
 *    AFCT already does by hand, so their work and grades survive and re-enrolling restores them.
 *  - **Course staff are AFCT's business, not the LMS's.** A faculty member or TA missing from
 *    the LMS roster is left alone: people are given access in AFCT for reasons an LMS does not
 *    know about, and quietly dropping a colleague mid-term would be worse than a stale row.
 */

import { prisma } from '@/lib/prisma';
import type { CourseRole } from '@prisma/client';
import { mapLtiRoles } from '@/lib/lti/course-link';
import type { Member } from '@/lib/lti/nrps';

/**
 * Which LMS course a change came from.
 *
 * A course can be opened by several LMS courses at once (cross-listed sections are separate
 * courses in an LMS), so a change carries its source rather than the caller assuming one. An
 * identity belongs to the platform that issued it, and membership belongs to the LMS course it
 * was read from; getting either wrong sends somebody's grades to the wrong gradebook.
 */
export type RosterSource = { issuer: string; contextLinkId: string };

export type RosterChange =
  /** Not in AFCT at all. An account is created if their address is new. */
  | {
      kind: 'add';
      member: Member;
      role: CourseRole;
      existingUserId: string | null;
      source: RosterSource;
    }
  /** On the roster already, but no LMS course that opens this one lists them as active. */
  | { kind: 'drop'; userId: string; name: string; role: CourseRole }
  /** Enrolled here, dropped in AFCT, and the LMS says they are back. */
  | { kind: 'restore'; userId: string; name: string }
  /** Present in both, and only their LMS identity is missing, so grades cannot be sent. */
  | {
      kind: 'link-identity';
      userId: string;
      name: string;
      ltiUserId: string;
      source: RosterSource;
    };

export type RosterDiff = {
  changes: RosterChange[];
  /** People in AFCT the LMS does not list, deliberately left alone. */
  keptStaff: { name: string; role: CourseRole }[];
  /** Already correct, so nothing to show. */
  unchanged: number;
};

const displayName = (first: string | null, last: string | null, fallback: string) =>
  `${first ?? ''} ${last ?? ''}`.trim() || fallback;

/**
 * What would change if these LMS rosters were applied to this course.
 *
 * Takes every LMS course that opens this one, not one of them. Cross-listed sections are
 * separate courses in an LMS and all of them open the same AFCT course, so reading one and
 * applying it would mark everybody in the others as dropped. The union is the roster.
 *
 * The issuer on each source identifies which platform an identity belongs to: the same person
 * can have one for institutional sign-in and one for the LMS, and only the LMS one can receive
 * a grade.
 */
export async function diffRoster(opts: {
  courseId: string;
  sources: { issuer: string; contextLinkId: string; members: Member[] }[];
}): Promise<RosterDiff> {
  const { courseId, sources } = opts;

  const roster = await prisma.roster.findMany({
    where: { courseId },
    select: {
      userId: true,
      role: true,
      status: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  /**
   * Identities keyed by platform as well as subject.
   *
   * Two platforms can hand out the same opaque subject for different people, so a bare subject
   * is not an identifier. This is the same pair the unique index on LinkedIdentity holds.
   */
  const issuers = [...new Set(sources.map((s) => s.issuer))];
  const identities = await prisma.linkedIdentity.findMany({
    where: { kind: 'LTI', issuer: { in: issuers } },
    select: { userId: true, subject: true, issuer: true },
  });
  const identityKey = (issuer: string, subject: string) => `${issuer}\u0000${subject}`;
  const userByLtiId = new Map(
    identities.map((i) => [identityKey(i.issuer, i.subject), i.userId] as const),
  );
  const ltiIdByUser = new Map(identities.map((i) => [i.userId, i.subject]));

  const emails = sources
    .flatMap((source) => source.members)
    .map((m) => m.email)
    .filter((e): e is string => Boolean(e));
  const byEmail = new Map(
    (
      await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    ).map((u) => [u.email, u.id]),
  );

  const rosterByUser = new Map(roster.map((r) => [r.userId, r]));
  const changes: RosterChange[] = [];
  const seen = new Set<string>();
  let unchanged = 0;

  for (const { issuer, contextLinkId, members } of sources) {
    const source = { issuer, contextLinkId };
    for (const member of members) {
      // The LMS id first, then a matching address. Same order as a launch, for the same reason:
      // an address can change, an id does not.
      const userId =
        userByLtiId.get(identityKey(issuer, member.ltiUserId)) ??
        (member.email ? byEmail.get(member.email) : undefined) ??
        null;
      const role = mapLtiRoles(member.roles);
      const name = displayName(member.firstName, member.lastName, member.email ?? member.ltiUserId);

      if (userId) seen.add(userId);
      const existing = userId ? rosterByUser.get(userId) : undefined;

      if (!member.active) {
        // Only a drop if they are actually enrolled here; otherwise there is nothing to do.
        if (existing && existing.status === 'ENROLLED') {
          changes.push({ kind: 'drop', userId: existing.userId, name, role: existing.role });
        }
        continue;
      }

      if (!existing) {
        changes.push({ kind: 'add', member, role, existingUserId: userId, source });
        continue;
      }

      if (existing.status === 'DROPPED') {
        changes.push({ kind: 'restore', userId: existing.userId, name });
        continue;
      }

      // Enrolled and correct. The one thing that may still be missing is the LMS identity, which
      // is what grade passback needs, and a student who has never launched will not have one.
      if (!ltiIdByUser.has(existing.userId)) {
        changes.push({
          kind: 'link-identity',
          userId: existing.userId,
          name,
          ltiUserId: member.ltiUserId,
          source,
        });
        continue;
      }

      unchanged++;
    }
  }

  /**
   * Anyone enrolled here that no LMS course listed.
   *
   * Students are dropped, matching what the LMS is telling us. Staff are not: access is given
   * in AFCT for reasons an LMS does not know about, and removing a colleague mid-term because
   * they are not in a Canvas section would be worse than a stale row.
   */
  const keptStaff: RosterDiff['keptStaff'] = [];
  for (const row of roster) {
    if (seen.has(row.userId) || row.status !== 'ENROLLED') continue;
    const name = displayName(row.user.firstName, row.user.lastName, row.user.email);

    if (row.role === 'STUDENT') {
      changes.push({ kind: 'drop', userId: row.userId, name, role: row.role });
    } else {
      keptStaff.push({ name, role: row.role });
    }
  }

  return { changes, keptStaff, unchanged };
}
