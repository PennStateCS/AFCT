import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
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
                    action: 'FETCH_SUBMISSION_LOGS_FAILED',
                    category: 'AUTH',
                    metadata: { reason: 'Not authenticated' },
                    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                    userAgent: req.headers.get('User-Agent') || null
                })
            }); 
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!session.user.isAdmin) {
            await fetch('/api/createActivityLog', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: session.user.id,
                    action: 'FETCH_SUBMISSION_LOGS_FAILED',
                    category: 'AUTH',
                    metadata: { reason: 'Unauthorized access' },
                    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                    userAgent: req.headers.get('User-Agent') || null
                })
            });
            return NextResponse.json({ error: 'Unauthorized Access' }, { status: 403 });
        }

        // Get body data
        const body = await req.json();
        const problemIds = Array.isArray(body?.problemIds) ? body.problemIds : [];
    
        // Validate problemIds
        if (problemIds.length === 0) {
            await fetch('/api/createActivityLog', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: session.user.id,
                    action: 'FETCH_SUBMISSION_LOGS_FAILED',
                    category: 'VALIDATION',
                    metadata: { reason: 'Missing problemIds' },
                    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                    userAgent: req.headers.get('User-Agent') || null
                })
            });
            return NextResponse.json({ error: 'Missing problemIds' }, { status: 400 });
        }

        // Fetch all submission logs
        const submissions = await prisma.submission.findMany({
            where: {
                problemId: { in: problemIds },
            },
            orderBy: {
                submittedAt: 'desc',
            },
            select: {
                id: true,
                studentId: true,
                courseId: true,
                assignmentId: true,
                problemId: true,
                correct: true,
                feedback: true,
                student: {
                select: {
                    email: true,
                    firstName: true,
                    lastName: true,
                    avatar: true,
                },
                },
                course: {
                select: { name: true },
                },
                assignmentProblem: {
                select: {
                    assignment: {
                    select: { title: true },
                    },
                    problem: {
                    select: { title: true },
                    },
                    maxPoints: true,
                },
                },
                submittedAt: true,
                status: true,
                fileName: true,
                originalFileName: true,
            },
        });

        // Get grades for the submissions
        const gradeMap = new Map(
            (
                await prisma.assignmentProblemGrade.findMany({
                where: {
                    studentId: { in: submissions.map((submission) => submission.studentId) },
                    assignmentId: { in: submissions.map((submission) => submission.assignmentId) },
                    problemId: { in: submissions.map((submission) => submission.problemId) },
                },
                select: {
                    studentId: true,
                    assignmentId: true,
                    problemId: true,
                    grade: true,
                },
                })
            ).map((row) => [`${row.studentId}:${row.assignmentId}:${row.problemId}`, row.grade] as const),
        );

        // Format the submissions for response
        const formattedSubmissions = submissions.map((submission) => ({
            id: submission.id,
            studentId: submission.studentId,
            courseId: submission.courseId,
            assignmentId: submission.assignmentId,
            problemId: submission.problemId,
            studentFirstName: submission.student.firstName,
            studentLastName: submission.student.lastName,
            studentEmail: submission.student.email,
            courseName: submission.course.name,
            assignmentTitle: submission.assignmentProblem.assignment.title,
            problemTitle: submission.assignmentProblem.problem.title,
            submittedAt: submission.submittedAt.toISOString(),
            status: submission.status,
            correct: submission.correct,
            feedback: submission.feedback,
            grade: gradeMap.get(`${submission.studentId}:${submission.assignmentId}:${submission.problemId}`) ?? null,
            maxPoints: submission.assignmentProblem.maxPoints,
            avatar: submission.student.avatar,
            fileName: submission.fileName,
            originalFileName: submission.originalFileName,
        }));

        // Log and return successful GET
        await fetch('/api/createActivityLog', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: session.user.id,
                action: 'FETCH_SUBMISSION_LOGS_SUCCESS',
                category: 'DATA',
                metadata: { problemIds },
                ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                userAgent: req.headers.get('User-Agent') || null
            })
        });
        return NextResponse.json(formattedSubmissions);
    } catch (error) {
        console.error('Error in GET /api/admin/submissionLogs:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}