import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { withAssignmentAuth } from '@/lib/api/with-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { findSubmissionMatches } from '@/lib/similarity/matches';
import { isCommon } from '@/lib/similarity/rarity';

type Ctx = { params: Promise<{ id: string; aid: string }> };

/**
 * Submissions to this assignment's problems that are the same file as somebody else's.
 * Course staff (faculty or TAs) or a system admin.
 *
 * Groups are scoped to one problem, so a group never reaches outside the course, and each
 * carries how many students share that content against how many submitted the problem at
 * all. Read that ratio before reading anything into a match: on an easy problem identical
 * work is what a correct answer looks like. Nothing here is a verdict.
 * @openapi
 * summary: List submissions matching each other in an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: part, in: query, required: false, schema: { type: string, enum: [count] }, description: "Counts only, for the tab badge" }
 * responses:
 *   200:
 *     description: Groups of submissions sharing identical content, rarest first.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const GET = withAssignmentAuth<Ctx>(
  async (req, _ctx, { user, courseId, assignment }) => {
    try {
      const links = await prisma.assignmentProblem.findMany({
        where: { assignmentId: assignment.id },
        select: {
          problemId: true,
          problem: {
            select: { title: true, type: true, answerContentHash: true, answerShapeHash: true },
          },
        },
      });

      const problems = new Map(
        links.map((link) => [
          link.problemId,
          {
            title: link.problem?.title ?? null,
            type: link.problem?.type ?? null,
            answerContentHash: link.problem?.answerContentHash ?? null,
            answerShapeHash: link.problem?.answerShapeHash ?? null,
          },
        ]),
      );
      const groups = await findSubmissionMatches([...problems.keys()], problems);

      // `?part=count` answers the tab badge: how many matches there are, without who they
      // are. Deliberately not logged, because nothing about a student is disclosed by a
      // number, and the assignment page would otherwise write an access entry every time
      // anybody opened any tab.
      if (new URL(req.url).searchParams.get('part') === 'count') {
        return NextResponse.json({
          matches: groups.length,
          notable: groups.filter((group) => !isCommon(group)).length,
          reusedAfterPass: groups.filter((group) => group.reusedAfterPass).length,
        });
      }

      // Staff reading who matched whom is access to student work, so it leaves a trail like
      // any other. Counts only: the names are in the response, not in the log.
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'ASSIGNMENT_SIMILARITY_VIEWED',
        severity: 'INFO',
        category: 'SUBMISSION',
        courseId,
        assignmentId: assignment.id,
        metadata: {
          matchGroups: groups.length,
          matchedSubmissions: groups.reduce((sum, group) => sum + group.submissions.length, 0),
        },
      });

      return NextResponse.json(groups);
    } catch (error) {
      console.error('GET /api/courses/[id]/assignments/[aid]/similarity error:', error);
      return apiError(500, 'Failed to load matching submissions');
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_SIMILARITY_ACCESS_DENIED' },
);
