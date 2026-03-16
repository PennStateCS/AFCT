import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCoursesListForUser } from '@/lib/courses-list';

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    const role = session?.user?.role;

    if (!userId || !role) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const courses = await getCoursesListForUser(userId, role);
    return NextResponse.json(courses, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch courses list:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
