import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Diagnostic lookup that returns a trimmed view of one assignment by id. Loads
 * the full course/problem graph but only echoes a few summary fields.
 * Unauthenticated, and appears to be a development helper rather than a route
 * the app itself calls.
 * @openapi
 * summary: Fetch an assignment summary (debug)
 * parameters:
 *   - { name: id, in: query, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: A summary of the assignment.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             id: { type: string }
 *             title: { type: string }
 *             courseId: { type: string }
 *             isPublished: { type: boolean }
 *             course: { type: object }
 *   400: { description: Missing id query parameter. }
 *   404: { description: No assignment with that id. }
 *   500: { description: Server error. }
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing assignment ID' }, { status: 400 });
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        course: true,
        problems: {
          include: {
            problem: true
          }
        }
      }
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: assignment.id,
      title: assignment.title,
      courseId: assignment.courseId,
      isPublished: assignment.isPublished,
      course: assignment.course
    });
  } catch (error) {
    console.error('Test assignment API error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
