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
import { generateUniqueCourseCode } from '@/lib/course-code';
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
  // Additional faculty to seed on the copy (on top of a copied faculty roster).
  instructorIds: z.array(z.string()).optional(),
});

const courseCodeRegex = /^[A-Z]{2,8}\s?\d{1,4}[A-Z]?$/;
const normalizeCode = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Creates a new course modeled on an existing one, in a single transaction. The
 * copy's faculty comes from the copied faculty roster and/or an explicit
 * `instructorIds` list — at least one faculty member is required (the caller is
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

      // A course must always have at least one faculty member — from the copied
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
        // If the source is already missing, the original is broken too — the copy just
        // has no solution file rather than a dangling pointer.
        if (!fs.existsSync(src)) return {};
        const newName = safeStoredFilename(p.originalFileName ?? p.fileName);
        const dest = resolveInsideDir(solutionsDir, newName);
        await fs.promises.copyFile(src, dest);
        copiedSolutionFiles.push(dest);
        return { fileName: newName, originalFileName: p.originalFileName ?? undefined };
      };

      // Begin transaction
      let result;
      try {
        result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Create new course (default not published)
        const regCode = await generateUniqueCourseCode();

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
        const originalRoster =
          copyFaculty || copyTAs ? await tx.roster.findMany({ where: { courseId } }) : [];

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

        if (copyTAs) {
          const taRows = originalRoster.filter(
            (r) => r.role === 'TA' && !facultyIds.has(r.userId),
          );
          if (taRows.length > 0) {
            await tx.roster.createMany({
              data: taRows.map((r) => ({
                courseId: newCourse.id,
                userId: r.userId,
                role: 'TA' as const,
              })),
            });
          }
        }

        // Fetch original assignments (with their linked problems)
        const originalAssignments = await tx.assignment.findMany({
          where: { courseId },
          include: { problems: { include: { problem: true } } },
        });

        // Map for problem id translation
        const problemIdMap: Record<string, string> = {};

        // Clone one problem into the new course (with its own solution-file copy) and
        // return the new id. Shared by the problems-only and assignments-with-problems
        // modes so the copy logic lives in one place.
        const cloneProblem = async (p: Problem): Promise<string> => {
          const solution = await copyProblemSolution(p);
          const created = await tx.problem.create({
            data: {
              title: p.title,
              description: p.description ?? undefined,
              ...solution,
              type: p.type ?? undefined,
              maxStates: p.maxStates ?? undefined,
              isDeterministic: p.isDeterministic ?? undefined,
              courseId: newCourse.id,
            },
          });
          return created.id;
        };

        // Depending on mode, fetch and copy problems:
        if (mode === 'problems') {
          // copy all problems
          const originalProblems = await tx.problem.findMany({ where: { courseId } });
          for (const p of originalProblems) {
            problemIdMap[p.id] = await cloneProblem(p);
          }
        } else if (mode === 'assignments_with_problems') {
          // copy only problems that are attached to assignments, and map them
          const neededProblemIds = new Set<string>();
          for (const a of originalAssignments) {
            for (const ap of a.problems) neededProblemIds.add(ap.problemId);
          }
          if (neededProblemIds.size > 0) {
            const problemsToCopy = await tx.problem.findMany({
              where: { id: { in: Array.from(neededProblemIds) } },
            });
            for (const p of problemsToCopy) {
              problemIdMap[p.id] = await cloneProblem(p);
            }
          }
        }

        // If mode is 'assignments', we will copy assignments but NOT create any assignmentProblem links.
        if (mode === 'assignments' || mode === 'assignments_with_problems') {
          for (const a of originalAssignments) {
            const createdA = await tx.assignment.create({
              data: {
                title: a.title,
                description: a.description ?? undefined,
                dueDate: a.dueDate,
                isPublished: false,
                courseId: newCourse.id,
              },
            });

            if (mode === 'assignments_with_problems') {
              // Link copied problems (only) to this new assignment according to original assignment mapping
              for (const ap of a.problems) {
                const oldProblemId = ap.problemId;
                const newProblemId = problemIdMap[oldProblemId];
                if (!newProblemId) continue; // skip if problem wasn't copied for some reason
                await tx.assignmentProblem.create({
                  data: { assignmentId: createdA.id, problemId: newProblemId },
                });
              }
            }
          }
        }

          return newCourse;
        });
      } catch (txErr) {
        // The duplication rolled back — remove any solution files we copied so they
        // don't leak as orphans.
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
        error: err,
        courseId: courseId,
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { deniedAction: 'COURSE_DUPLICATE_DENIED' },
);
