import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Missing assignment ID' }, { status: 400 });
    }

    console.log('Testing assignment fetch for ID:', id);

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
      console.log('Assignment not found in database');
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    console.log('Assignment found:', {
      id: assignment.id,
      title: assignment.title,
      courseId: assignment.courseId,
      isPublished: assignment.isPublished
    });

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
