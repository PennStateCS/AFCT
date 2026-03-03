// /src/app/api/problems/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { auth } from '@/lib/auth';
import { ProblemType } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';

// PUT /api/problems/[id] - Update an existing problem
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: problemId } = await context.params;

    // Verify authenticated user
    const session = await auth();
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Check if problem exists
    const existingProblem = await prisma.problem.findUnique({
      where: { id: problemId },
    });

    if (!existingProblem) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    // Parse multipart form data
    const formData = await req.formData();

    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const type = formData.get('type') as string;
    const maxSubmissions = formData.get('maxSubmissions') as string | null;
    const maxPoints = formData.get('maxPoints') as string | null;
    const courseId = formData.get('courseId') as string;
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
      category: 'PROBLEM',
      courseId,
      problemId,
      metadata: {
        userId: user.id,
        courseId: courseId,
        problemId: problemId,
        problemType: type,
        fileName,
        fileUpdated: !!file,
      },
    });

    return NextResponse.json(updatedProblem);
  } catch (err) {
    console.error('Problem update error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE /api/problems/[id] - Delete a problem
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: problemId } = await context.params;

    // Verify authenticated user
    const session = await auth();
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Check if problem exists
    const existingProblem = await prisma.problem.findUnique({
      where: { id: problemId },
    });

    if (!existingProblem) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
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
      category: 'PROBLEM',
      courseId: existingProblem.courseId,
      problemId,
      metadata: {
        userId: user.id,
        courseId: existingProblem.courseId,
        problemId: problemId,
        fileName: existingProblem.fileName || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Problem deletion error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
