import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { withCourseAuth } from '@/lib/api/with-auth';
import type { SimilarityReportJsonData } from '@/lib/simulatiry_report/types';

type Ctx = { params: Promise<{ id: string; aid: string }> };

type SimilarityReportUser = {
    id: string;
    firstName: string | null;
    lastName: string | null;
    avatar: string | null;
    cropX: number | null;
    cropY: number | null;
    zoom: number | null;
};

type SuspiciousSubmissionMatch = {
    id: string;
    submittedAt: Date;
    fileName: string | null;
    originalFileName: string | null;
    isSuspicious: boolean | null;
    isSuspiciousOverride: boolean | null;
    isSuspiciousReason: string | null;
    similarityReportJson: SimilarityReportJsonData | null;
    student: SimilarityReportUser;
    problem: {
        id: string;
        title: string | null;
        type: string | null;
    };
    studentGroup: { id: string; name: string } | null;
};

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
                    isSuspiciousOverride: false,
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
                    similarityReportJson: true,
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
                            type: true,
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

            const allUserIds = new Set<string>();
            const allSubmissionIds = new Set<string>();

            submissions.forEach((submission) => {
                const report = submission.similarityReportJson as SimilarityReportJsonData | null;
                if (!report) {
                    return;
                }

                report.file_hash_user_ids?.forEach((id) => allUserIds.add(id));
                report.calc_hash_user_ids?.forEach((id) => allUserIds.add(id));
                report.file_hash_submission_ids?.forEach((id) => allSubmissionIds.add(id));
                report.calc_hash_submission_ids?.forEach((id) => allSubmissionIds.add(id));
            });

            const [users, matchedSubmissions] = await Promise.all([
                allUserIds.size
                    ? prisma.user.findMany({
                          where: { id: { in: Array.from(allUserIds) } },
                          select: {
                              id: true,
                              firstName: true,
                              lastName: true,
                              avatar: true,
                              cropX: true,
                              cropY: true,
                              zoom: true,
                          },
                      })
                    : Promise.resolve([]),
                allSubmissionIds.size
                    ? prisma.submission.findMany({
                          where: { id: { in: Array.from(allSubmissionIds) } },
                          select: {
                              id: true,
                              submittedAt: true,
                              fileName: true,
                              originalFileName: true,
                              isSuspicious: true,
                              isSuspiciousOverride: true,
                              isSuspiciousReason: true,
                              similarityReportJson: true,
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
                                      type: true,
                                  },
                              },
                              studentGroup: {
                                  select: {
                                      id: true,
                                      name: true,
                                  },
                              },
                          },
                      })
                    : Promise.resolve([]),
            ]);

            const userById = new Map(users.map((user) => [user.id, user]));
            const submissionById = new Map(matchedSubmissions.map((matched) => [matched.id, matched]));

            const enhancedSubmissions = submissions.map((submission) => {
                const report = submission.similarityReportJson as SimilarityReportJsonData | null;
                return {
                    ...submission,
                    fileHashUsers:
                        report?.file_hash_user_ids?.map((id) => userById.get(id)).filter((item): item is SimilarityReportUser => Boolean(item)) ?? [],
                    calcHashUsers:
                        report?.calc_hash_user_ids?.map((id) => userById.get(id)).filter((item): item is SimilarityReportUser => Boolean(item)) ?? [],
                    fileHashSubmissions:
                        (report?.file_hash_submission_ids?.map((id) => submissionById.get(id)) ?? []).filter(Boolean) as SuspiciousSubmissionMatch[],
                    calcHashSubmissions:
                        (report?.calc_hash_submission_ids?.map((id) => submissionById.get(id)) ?? []).filter(Boolean) as SuspiciousSubmissionMatch[],
                };
            });

            return NextResponse.json(enhancedSubmissions);
        } catch (error) {
            console.error('GET /api/courses/[id]/assignments/[aid]/similarity error:', error);
            return apiError(500, 'Failed to fetch suspicious submissions');
        }
    },
    { access: 'manage', deniedAction: 'ASSIGNMENT_SIMILARITY_ACCESS_DENIED', deniedCategory: 'SUBMISSION' },
);
