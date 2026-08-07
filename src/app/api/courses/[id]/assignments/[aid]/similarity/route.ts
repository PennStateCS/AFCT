import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { withCourseAuth } from '@/lib/api/with-auth';

type Ctx = { params: Promise<{ id: string; aid: string }> };

export const GET = withCourseAuth(
    async (_req, ctx: Ctx, { courseId }) => {
        const { aid: assignmentId } = await ctx.params;
        if (!assignmentId) {
            return apiError(404, 'Assignment not found');
        }

        const assignment = await prisma.assignment.findFirst({
            where: { id: assignmentId, courseId },
            select: { id: true },
        });
        if (!assignment) {
        return apiError(404, 'Assignment not found');
        }

        try {
            const submissions = await prisma.submission.findMany({
                where: {
                    assignmentId,
                    courseId,
                    isSuspicious: true,
                },
                orderBy: { submittedAt: 'desc' },
                select: {
                    id: true,
                    submittedAt: true,
                    fileName: true,
                    originalFileName: true,
                    isSuspicious: true,
                    isSuspiciousOverride: true,
                    isSuspiciousReason: true,
                    student: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            avatar: true,
                            cropX: true,
                            cropY: true,
                            zoom: true,
                        },
                    },
                    problem: {
                        select: {
                            id: true,
                            title: true,
                        },
                    },
                    studentGroup: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            });

            return NextResponse.json(submissions);
        } catch (error) {
            console.error('GET /api/courses/[id]/assignments/[aid]/similarity error:', error);
            return apiError(500, 'Failed to fetch suspicious submissions');
        }
    },
    { access: 'manage', deniedAction: 'ASSIGNMENT_SIMILARITY_ACCESS_DENIED', deniedCategory: 'SUBMISSION' },
);
