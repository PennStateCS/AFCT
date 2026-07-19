import { NextResponse } from 'next/server';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { createWithUniqueCourseCode } from '@/lib/course-code';
import { resolveUserTimezone } from '@/lib/user-timezone';
import { parseValidDate } from '@/lib/date';
import { toDateTimeInTimezone } from '@/lib/date-utils';
import { toEmptyStringNotation } from '@/lib/empty-string-notation';
import type { Prisma, Problem } from '@prisma/client';

// Permissive body schema: guarantees a well-typed object (and rejects malformed
// JSON) while the handler keeps its own credits/code/date validation below. Dates
// stay as strings for the timezone conversion.
const DuplicateBody = z.object({
  title: z.string().optional(),
  code: z.string().optional(),
  semester: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  registrationOpenAt: z.string().optional(),
  registrationCloseAt: z.string().optional(),
  credits: z.union([z.string(), z.number()]).optional(),
  emptyStringNotation: z.string().optional(),
  copyAssignments: z.boolean().optional(),
  copyProblems: z.boolean().optional(),
  copyMode: z.enum(['assignments', 'problems', 'assignments_with_problems']).optional(),
  copyFaculty: z.boolean().optional(),
  copyTAs: z.boolean().optional(),
  instructorIds: z.array(z.string()).optional(),
  taIds: z.array(z.string()).optional(),
});

const courseCodeRegex = /^[A-Z]{2,8}\s?\d{1,4}[A-Z]?$/;
const normalizeCode = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Creates a new course modeled on an existing one, in a single transaction. The
 * copy's faculty comes from the copied faculty roster and/or an explicit
 * `instructorIds` list; at least one faculty member is required (the caller is
 * NOT added automatically). TAs are copied only when asked. `copyMode` (or the
 * legacy copyAssignments/copyProblems booleans) selects what carries over:
 * assignments only, problems only, or assignments with their problems. The copy
 * always starts unpublished with a fresh registration code. System administrators
 * only. Dates are interpreted in the actor's timezone.
 * @openapi
 * summary: Duplicate a course
 * parameters:
 *   - { name: id, in: path, required: true, description: Source course id, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [title, code, semester, startDate, endDate, registrationOpenAt, registrationCloseAt, credits]
 *         properties:
 *           title: { type: string }
 *           code: { type: string, description: Like "CMPSC 221" or "MATH220" }
 *           semester: { type: string }
 *           credits: { type: integer, minimum: 1, maximum: 6 }
 *           startDate: { type: string }
 *           endDate: { type: string }
 *           registrationOpenAt: { type: string }
 *           registrationCloseAt: { type: string }
 *           emptyStringNotation: { type: string }
 *           copyMode: { type: string, enum: [assignments, problems, assignments_with_problems] }
 *           copyAssignments: { type: boolean, description: Legacy fallback for copyMode }
 *           copyProblems: { type: boolean, description: Legacy fallback for copyMode }
 *           copyFaculty: { type: boolean }
 *           copyTAs: { type: boolean }
 *           instructorIds: { type: array, items: { type: string }, description: "Additional faculty for the copy. Combined with copyFaculty, the result must include at least one faculty member." }
 * responses:
 *   201:
 *     description: The new course id.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { id: { type: string }, message: { type: string } } }
 *   400: { description: "Missing fields, bad credits, bad code, invalid dates, or no faculty for the copy." }
 *   401: { description: Not signed in. }
 *   403: { description: System administrators only (logged as a security event). }
 *   500: { description: Server error. }
 */
export const POST = withAdminAuth(
  async (req, ctx: { params: Promise<{ id: string }> }, { user }) => {
    const { id: courseId } = await ctx.params;
    const actorId = user.id;

    try {
      const parsed = await readJson(req, DuplicateBody);
      if (!parsed.ok) return parsed.response;
      const {
        title,
        code,
        semester,
        startDate,
        endDate,
        registrationOpenAt,
        registrationCloseAt,
        credits,
        emptyStringNotation,
        copyAssignments: bodyCopyAssignments,
        copyProblems: bodyCopyProblems,
        copyMode,
        copyFaculty = false,
        copyTAs = false,
        instructorIds = [],
        taIds = [],
      } = parsed.data;

      const parsedCredits = Number(credits);
      if (!Number.isInteger(parsedCredits) || parsedCredits < 1 || parsedCredits > 6) {
        return NextResponse.json(
          { error: 'Credits must be an integer between 1 and 6.' },
          { status: 400 },
        );
      }

      // Determine normalized mode: 'assignments' | 'problems' | 'assignments_with_problems'
      let mode: 'assignments' | 'problems' | 'assignments_with_problems' =
        'assignments_with_problems';
      if (copyMode) {
        if (copyMode === 'assignments') mode = 'assignments';
        else if (copyMode === 'problems') mode = 'problems';
        else mode = 'assignments_with_problems';
      } else {
        // fallback to legacy booleans
        if (bodyCopyAssignments && bodyCopyProblems) mode = 'assignments_with_problems';
        else if (bodyCopyAssignments) mode = 'assignments';
        else if (bodyCopyProblems) mode = 'problems';
        else mode = 'assignments_with_problems';
      }

      // Validate minimal fields
      if (
        !title ||
        !semester ||
        !startDate ||
        !endDate ||
        !registrationOpenAt ||
        !registrationCloseAt
      ) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      if (typeof code !== 'string' || !courseCodeRegex.test(normalizeCode(code))) {
        return NextResponse.json(
          { error: 'Use a code like "CMPSC 221" or "MATH220".' },
          { status: 400 },
        );
      }

      const parsedStartDate = parseValidDate(startDate);
      const parsedEndDate = parseValidDate(endDate);
      const parsedRegistrationOpenAt = parseValidDate(registrationOpenAt);
      const parsedRegistrationCloseAt = parseValidDate(registrationCloseAt);

      if (
        !parsedStartDate ||
        !parsedEndDate ||
        !parsedRegistrationOpenAt ||
        !parsedRegistrationCloseAt
      ) {
        return NextResponse.json({ error: 'Invalid date/time value.' }, { status: 400 });
      }

      if (parsedStartDate > parsedEndDate) {
        return NextResponse.json(
          { error: 'Start date/time must be on or before the end date/time.' },
          { status: 400 },
        );
      }

      if (parsedRegistrationOpenAt > parsedRegistrationCloseAt) {
        return NextResponse.json(
          { error: 'Self registration open must be on or before the close date.' },
          { status: 400 },
        );
      }

      // A course must always have at least one faculty member: from the copied
      // faculty roster and/or the explicit list. The caller is NOT auto-added.
      if (!copyFaculty && instructorIds.length === 0) {
        return NextResponse.json(
          { error: 'Copy the faculty roster or pick at least one faculty member.' },
          { status: 400 },
        );
      }

      const userTimezone = await resolveUserTimezone(actorId);

      // Solution files live here. Duplicated problems get their OWN physical copy so
      // the two rows don't share one file (a later delete/replace of one problem would
      // otherwise unlink the file the other still points at). Track the copies so a
      // rolled-back transaction leaves no orphaned files behind.
      const solutionsDir = path.join('/private', 'uploads', 'solutions');
      const copiedSolutionFiles: string[] = [];
      const copyProblemSolution = async (p: {
        fileName: string | null;
        originalFileName: string | null;
      }): Promise<{ fileName?: string; originalFileName?: string }> => {
        if (!p.fileName) return {};
        const src = resolveInsideDir(solutionsDir, p.fileName);
        // If the source is already missing, the original is broken too; the copy just
        // has no solution file rather than a dangling pointer.
        if (!fs.existsSync(src)) return {};
        const newName = safeStoredFilename(p.originalFileName ?? p.fileName);
        const dest = resolveInsideDir(solutionsDir, newName);
        await fs.promises.copyFile(src, dest);
        copiedSolutionFiles.push(dest);
        return { fileName: newName, originalFileName: p.originalFileName ?? undefined };
      };

      // Everything that isn't a DB write happens BEFORE the transaction. Prisma's
      // interactive transactions have a ~5s timeout and hold row locks for their
      // whole duration; copying solution files (slow filesystem I/O) inside one risks
      // blowing the timeout and rolling back the entire duplication on a course with
      // many problems. So read the source data and copy the files first, then keep the
      // transaction to pure DB writes. If a copy or the transaction fails, the catch
      // unlinks whatever we copied so nothing leaks.
      let result;
      try {
        // Source assignments (with their linked problems) and roster.
        const originalAssignments = await prisma.assignment.findMany({
          where: { courseId },
          include: { problems: { include: { problem: true } } },
        });
        const originalRoster =
          copyFaculty || copyTAs ? await prisma.roster.findMany({ where: { courseId } }) : [];

        // Which problems carry over depends on the mode: all of them, only those
        // attached to assignments, or none.
        let problemsToCopy: Problem[] = [];
        if (mode === 'problems') {
          problemsToCopy = await prisma.problem.findMany({ where: { courseId } });
        } else if (mode === 'assignments_with_problems') {
          const neededProblemIds = new Set<string>();
          for (const a of originalAssignments) {
            for (const ap of a.problems) neededProblemIds.add(ap.problemId);
          }
          if (neededProblemIds.size > 0) {
            problemsToCopy = await prisma.problem.findMany({
              where: { id: { in: Array.from(neededProblemIds) } },
            });
          }
        }

        // Copy each problem's solution file up front, keyed by the source problem id;
        // the transaction reuses these instead of doing I/O while holding locks.
        const solutionByProblemId = new Map<
          string,
          { fileName?: string; originalFileName?: string }
        >();
        for (const p of problemsToCopy) {
          solutionByProblemId.set(p.id, await copyProblemSolution(p));
        }

        // A unique reg code is chosen before the insert, so a concurrent create could
        // claim it in between; retry the whole transaction with a fresh code on the
        // rare P2002 conflict.
        result = await createWithUniqueCourseCode((regCode) =>
          prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Create new course (default not published)
            const newCourse = await tx.course.create({
              data: {
                name: title,
                code: normalizeCode(code),
                semester,
                credits: parsedCredits,
                startDate: toDateTimeInTimezone(startDate, userTimezone),
                endDate: toDateTimeInTimezone(endDate, userTimezone),
                registrationOpenAt: toDateTimeInTimezone(registrationOpenAt, userTimezone),
                registrationCloseAt: toDateTimeInTimezone(registrationCloseAt, userTimezone),
                isPublished: false,
                isArchived: false,
                emptyStringNotation: toEmptyStringNotation(emptyStringNotation),
                regCode,
              },
            });

            // Seed the roster: faculty from the copied roster and/or the explicit
            // list (deduped; faculty wins over a TA row for the same user).
            const facultyIds = new Set<string>(instructorIds);
            if (copyFaculty) {
              for (const r of originalRoster) {
                if (r.role === 'FACULTY') facultyIds.add(r.userId);
              }
            }
            if (facultyIds.size > 0) {
              await tx.roster.createMany({
                data: Array.from(facultyIds).map((userId) => ({
                  courseId: newCourse.id,
                  userId,
                  role: 'FACULTY' as const,
                })),
              });
            }

            if (copyTAs || taIds.length > 0) {
              const taSet = new Set<string>();

              if (copyTAs) {
                for (const r of originalRoster) {
                  if (r.role === 'TA' && !facultyIds.has(r.userId)) {
                    taSet.add(r.userId);
                  }
                }
              }

              for (const userId of taIds) {
                if (!facultyIds.has(userId)) {
                  taSet.add(userId);
                }
              }

              if (taSet.size > 0) {
                await tx.roster.createMany({
                  data: Array.from(taSet).map((userId) => ({
                    courseId: newCourse.id,
                    userId,
                    role: 'TA' as const,
                  })),
                });
              }
            }

            // Clone the problems (each needs its own id for the link map, so these
            // stay individual creates), reusing the solution files copied above.
            const problemIdMap: Record<string, string> = {};
            for (const p of problemsToCopy) {
              const created = await tx.problem.create({
                data: {
                  title: p.title,
                  description: p.description ?? undefined,
                  ...(solutionByProblemId.get(p.id) ?? {}),
                  type: p.type ?? undefined,
                  maxStates: p.maxStates ?? undefined,
                  isDeterministic: p.isDeterministic ?? undefined,
                  courseId: newCourse.id,
                },
              });
              problemIdMap[p.id] = created.id;
            }

            // Copy assignments (individual creates, for their ids) and collect the
            // assignment->problem links; the links then go in one batched insert.
            // In 'assignments' mode no links are created.
            if (mode === 'assignments' || mode === 'assignments_with_problems') {
              const links: { assignmentId: string; problemId: string }[] = [];
              for (const a of originalAssignments) {
                const createdA = await tx.assignment.create({
                  data: {
                    title: a.title,
                    description: a.description ?? undefined,
                    dueDate: a.dueDate,
                    unlockAt: a.unlockAt,
                    assignedToEveryone: a.assignedToEveryone,
                    isPublished: false,
                    courseId: newCourse.id,
                  },
                });

                if (mode === 'assignments_with_problems') {
                  for (const ap of a.problems) {
                    const newProblemId = problemIdMap[ap.problemId];
                    if (!newProblemId) continue; // skip if the problem wasn't copied
                    links.push({ assignmentId: createdA.id, problemId: newProblemId });
                  }
                }
              }
              if (links.length > 0) {
                await tx.assignmentProblem.createMany({ data: links });
              }
            }

            return newCourse;
          }),
        );
      } catch (txErr) {
        // A read, a file copy, or the transaction failed; remove any solution files
        // we copied so they don't leak as orphans.
        await Promise.all(copiedSolutionFiles.map((f) => fs.promises.unlink(f).catch(() => {})));
        throw txErr;
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: actorId,
        action: 'COURSE_DUPLICATED',
        severity: 'INFO',
        category: 'COURSE',
        courseId: result.id,
        metadata: {
          actorId,
          sourceCourseId: courseId,
          newCourseId: result.id,
          newCourseName: result.name,
          newCourseCode: result.code,
          copyMode: mode,
          copyFaculty: !!copyFaculty,
          copyTAs: !!copyTAs,
        },
      });

      return NextResponse.json({ id: result.id, message: 'Course duplicated' }, { status: 201 });
    } catch (err) {
      console.error('Duplicate course error:', err);
      await logError(req, {
        userId: actorId,
        action: 'COURSE_DUPLICATE_ERROR',
        category: 'COURSE',
        error: err,
        courseId: courseId,
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { deniedAction: 'COURSE_DUPLICATE_DENIED' },
);
