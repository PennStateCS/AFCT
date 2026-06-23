import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';


export async function GET(req: NextRequest) {
    try {
        // Authorize user
        const session = await auth();

        if (!session?.user?.id) {
            await fetch('/api/createActivityLog', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'FETCH_COURSES_FAILED',
                    category: 'AUTH',
                    metadata: { reason: 'Not authenticated' },
                    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                    userAgent: req.headers.get('User-Agent') || null
                })
            }); 
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (session.user.role !== 'ADMIN') {
            await fetch('/api/createActivityLog', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: session.user.id,
                    action: 'FETCH_COURSES_FAILED',
                    category: 'AUTH',
                    metadata: { reason: 'Unauthorized access' },
                    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                    userAgent: req.headers.get('User-Agent') || null
                })
            });
            return NextResponse.json({ error: 'Unauthorized Access' }, { status: 403 });
        }

        // Fetch all courses
        const courses = await prisma.course.findMany({
            select: {
                id: true,
                name: true,
                code: true,
                regCode: true,
                semester: true,
                credits: true,
                startDate: true,
                endDate: true,
                registrationOpenAt: true,
                registrationCloseAt: true,
                isPublished: true,
                isArchived: true,
                createdAt: true,
                updatedAt: true,
                roster: {
                    select: {
                        user: {
                            where: {
                                role: { in: ['INSTRUCTOR', 'TA'] }
                            },
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                role: true
                            }
                        }
                    }
                }
            }
        });

        // Log and return successful GET
        await fetch('/api/createActivityLog', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: session.user.id,
                action: 'FETCH_COURSES_SUCCESS',
                category: 'AUTH',
                metadata: { courseCount: courses.length },
                ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                userAgent: req.headers.get('User-Agent') || null
            })
        });
        return NextResponse.json(courses, { status: 200 });
    } catch (error) {
        console.error('Error in GET /api/admin/allCourses:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}