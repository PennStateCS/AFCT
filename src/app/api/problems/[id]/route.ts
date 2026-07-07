import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { auth } from '@/lib/auth';
import { canManageCourse } from '@/lib/permissions';
import { ProblemType } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';

/**
 * Updates a problem (multipart/form-data). Course staff (faculty or TAs) or a system
 * admin. Sending a new file replaces the stored solution — it's structure-validated
 * and size-checked first, and the previous file is removed. Omitting the file keeps
 * the current one.
 * @openapi
 * summary: Update a problem
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         required: [title, type, courseId]
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           type: { type: string }
 *           courseId: { type: string }
 *           maxPoints: { type: string }
 *           maxSubmissions: { type: string }
 *           maxStates: { type: string }
 *           isDeterministic: { type: string, enum: ['true', 'false'] }
 *           autograderEnabled: { type: string, enum: ['true', 'false'] }
 *           file: { type: string, format: binary, description: Optional new solution file }
 * responses:
 *   200: { description: The updated problem. }
 *   400: { description: Missing fields or the new file failed structure validation. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: Problem not found. }
 *   413: { description: File exceeds the system upload limit. }
 *   500: { description: Server error. }
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  let actorId: string | null = null;
  try {
    const { id: problemId } = await context.params;

    // Verify authenticated user
    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;

    if (!user) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Check if problem exists
    const existingProblem = await prisma.problem.findUnique({
      where: { id: problemId },
    });

    if (!existingProblem) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    if (!(await canManageCourse(user, existingProblem.courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Parse multipart form data
    const formData = await req.formData();

    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const type = formData.get('type') as string;
    const maxSubmissions = formData.get('maxSubmissions') as string | null;
    const maxPoints = formData.get('maxPoints') as string | null;
    const courseId = formData.get('courseId') as string;
    const assignmentId = formData.get('assignmentId') as string;
    const maxStates = formData.get('maxStates') as string | null;
    const isDeterministic = formData.get('isDeterministic') === 'true';
    const autograderEnabled = formData.get('autograderEnabled') === 'true';
    const file = formData.get('file') as File | null;

    // Validate required fields
    if (!title || !courseId || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    let fileName = existingProblem.fileName;
    let originalFileName = existingProblem.originalFileName;

    // Handle file update if a new file is provided
    if (file && file.size > 0) {
      const { maxBytes, maxMb } = await getSystemUploadLimit();
      if (file.size > maxBytes) {
        return NextResponse.json(
          { error: `File exceeds max upload size (${maxMb} MB).` },
          { status: 413 },
        );
      }
      const xml = await file.text();
      const validation = validateStructureXML(xml, type);

      // Error check
      if (!validation.isValid) {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'SUBMISSION_INVALID_FILE_STRUCTURE',
          severity: 'WARNING',
          category: 'SUBMISSION',
          courseId,
          assignmentId,
          problemId,
          metadata: {
            userId: user.id,
            courseId,
            assignmentId,
            problemId,
            error: validation.error,
          },
        });

      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

      // Ensure upload directory exists
      const uploadsDir = path.join('/private', 'uploads', 'solutions');
      fs.mkdirSync(uploadsDir, { recursive: true });

      // Delete old file if it exists
      if (existingProblem.fileName) {
        const oldFilePath = path.join(uploadsDir, existingProblem.fileName);
        try {
          fs.unlinkSync(oldFilePath);
        } catch (err) {
          console.warn('Could not delete old file:', err);
        }
      }

      // Write new file to disk
      const buffer = Buffer.from(await file.arrayBuffer());
      fileName = `${Date.now()}-${file.name}`;
      originalFileName = file.name;
      const fullPath = path.join(uploadsDir, fileName);
      fs.writeFileSync(fullPath, buffer);
    }

    // Update the problem record in the database
    const updatedProblem = await prisma.problem.update({
      where: { id: problemId },
      data: {
        title,
        description,
        type: type as ProblemType,
        courseId,
        fileName,
        originalFileName,
        maxSubmissions: maxSubmissions ? parseInt(maxSubmissions, 10) : null,
        maxPoints: maxPoints ? parseInt(maxPoints, 10) : undefined,
        maxStates: ['FA', 'PDA'].includes(type) ? parseInt(maxStates || '0', 10) || null : null,
        isDeterministic: type === 'FA' ? isDeterministic : null,
        ...(autograderEnabled !== undefined && { autograderEnabled: autograderEnabled }),
      },
    });
    // Log update activity
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'UPDATE_PROBLEM',
      severity: 'INFO',
      category: 'PROBLEM',
      courseId,
      problemId,
      metadata: {
        userId: user.id,
        courseId: courseId,
        problemId: problemId,
        problemTitle: updatedProblem.title,
        problemType: type,
        maxPoints: updatedProblem.maxPoints,
        autograderEnabled: updatedProblem.autograderEnabled,
        fileName,
        fileUpdated: !!file,
      },
    });

    return NextResponse.json(updatedProblem);
  } catch (err) {
    console.error('Problem update error:', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'PROBLEM_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * Deletes a problem and its solution file. Course staff (faculty or TAs) or a system
 * admin. Refused while the problem is still attached to any assignment; otherwise its
 * submissions are removed first, then the record and file.
 * @openapi
 * summary: Delete a problem
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Problem deleted. }
 *   400: { description: Problem is still linked to an assignment. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: Problem not found. }
 *   500: { description: Server error. }
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  let actorId: string | null = null;
  try {
    const { id: problemId } = await context.params;

    // Verify authenticated user
    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;

    if (!user) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_DELETE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Check if problem exists
    const existingProblem = await prisma.problem.findUnique({
      where: { id: problemId },
    });

    if (!existingProblem) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    if (!(await canManageCourse(user, existingProblem.courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_DELETE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Prevent deletion if the problem is linked to any assignment
    const linked = await prisma.assignmentProblem.findFirst({ where: { problemId } });
    if (linked) {
      return NextResponse.json(
        { error: 'Problem is associated with an assignment and cannot be deleted' },
        { status: 400 },
      );
    }

    // Delete associated submissions first
    await prisma.submission.deleteMany({
      where: { problemId },
    });

    // Delete the problem file if it exists
    if (existingProblem.fileName) {
      const uploadsDir = path.join('/private', 'uploads', 'solutions');
      const filePath = path.join(uploadsDir, existingProblem.fileName);
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn('Could not delete problem file:', err);
      }
    }

    // Delete the problem record
    await prisma.problem.delete({
      where: { id: problemId },
    });

    // Log deletion activity
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'DELETE_PROBLEM',
      severity: 'INFO',
      category: 'PROBLEM',
      courseId: existingProblem.courseId,
      problemId,
      metadata: {
        userId: user.id,
        courseId: existingProblem.courseId,
        problemId: problemId,
        problemTitle: existingProblem.title,
        fileName: existingProblem.fileName || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Problem deletion error:', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'PROBLEM_DELETE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
