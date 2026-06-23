import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userId, action, metadata, courseId, assignmentId, problemId, submissionId, category, ipAddress, userAgent } = body || {};
    
        await prisma.activityLog.create({
            data: {
                userId,
                action,
                metadata,
                courseId,
                assignmentId,
                problemId,
                submissionId,
                category,
                ipAddress,
                userAgent
            }
        });
        return NextResponse.json({ ok: true }, { status: 201 });
    }
    catch (err) {
        console.error('Error in POST /api/createActivityLog:', err);
        return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
    }
}