import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withAdminAuth } from '@/lib/api/with-auth';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { generateUniqueCourseCode } from '@/lib/course-code';
import { resolveUserTimezone } from '@/lib/user-timezone';
import { parseValidDate } from '@/lib/date';
import { toDateTimeInTimezone } from '@/lib/date-utils';
import { toEmptyStringNotation } from '@/lib/empty-string-notation';
import type { Prisma } from '@prisma/client';

const courseCodeRegex = /^[A-Z]{2,8}\s?\d{1,4}[A-Z]?$/;
const normalizeCode = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Creates a new course modeled on an existing one, in a single transaction. The
 * caller becomes faculty on the copy; faculty/TA rosters are copied only when
 * asked. `copyMode` (or the legacy copyAssignments/copyProblems booleans) selects
 * what carries over: assignments only, problems only, or assignments with their
 * problems. The copy always starts unpublished with a fresh registration code.
 * System administrators only. Dates are interpreted in the actor's timezone.
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
 * responses:
 *   201:
 *     description: The new course id.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { id: { type: string }, message: { type: string } } }
 *   400: { description: "Missing fields, bad credits, bad code, or invalid dates." }
 *   401: { description: Not signed in. }
 *   403: { description: System administrators only (logged as a security event). }
 *   500: { description: Server error. }
 */
export const POST = withAdminAuth(
  async (req, ctx: { params: Promise<{ id: string }> }, { user }) => {
    const { id: courseId } = await ctx.params;
    const actorId = user.id;

    try {
      const body = await req.json();
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
      } = body ?? {};

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

        // Assign current user as faculty in roster
        await tx.roster.create({
          data: {
            courseId: newCourse.id,
            userId: actorId,
            role: 'FACULTY',
          },
        });

        // Optionally copy faculty/TAs from original roster
        if (copyFaculty || copyTAs) {
          const originalRoster = await tx.roster.findMany({ where: { courseId } });
          for (const r of originalRoster) {
            if (r.userId === actorId) continue; // already added
            if (
              ((r.role as string) === 'FACULTY' || (r.role as string) === 'ADMIN') &&
              copyFaculty
            ) {
              await tx.roster.create({
                data: { courseId: newCourse.id, userId: r.userId, role: r.role },
              });
            }
            if (r.role === 'TA' && copyTAs) {
              await tx.roster.create({
                data: { courseId: newCourse.id, userId: r.userId, role: r.role },
              });
            }
          }
        }

        // Fetch original assignments (with their linked problems)
        const originalAssignments = await tx.assignment.findMany({
          where: { courseId },
          include: { problems: { include: { problem: true } } },
        });

        // Map for problem id translation
        const problemIdMap: Record<string, string> = {};

        // Depending on mode, fetch and copy problems:
        if (mode === 'problems') {
          // copy all problems
          const originalProblems = await tx.problem.findMany({ where: { courseId } });
          for (const p of originalProblems) {
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
            problemIdMap[p.id] = created.id;
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
              problemIdMap[p.id] = created.id;
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
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { deniedAction: 'COURSE_DUPLICATE_DENIED' },
);
