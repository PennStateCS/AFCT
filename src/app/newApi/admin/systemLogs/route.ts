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
                    action: 'FETCH_SYSTEM_LOGS_FAILED',
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
                    action: 'FETCH_SYSTEM_LOGS_FAILED',
                    category: 'AUTH',
                    metadata: { reason: 'Unauthorized access' },
                    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                    userAgent: req.headers.get('User-Agent') || null
                })
            });
            return NextResponse.json({ error: 'Unauthorized Access' }, { status: 403 });
        }

        // Get system logs and include user first and last names
        const activityLogs = await prisma.activityLog.findMany({
        orderBy: {
            timestamp: 'desc',
        },
        include: {
            user: {
            select: {
                firstName: true,
                lastName: true,
            },
            },
        },
        });

        const result = activityLogs.map(log => {
            const { user, ...logData } = log;

            return {
                ...logData,
                firstName: user?.firstName ?? null,
                lastName: user?.lastName ?? null,
            };
        });

        // Log and return successful GET
        await fetch('/api/createActivityLog', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: session.user.id,
                action: 'FETCH_SYSTEM_LOGS_SUCCESS',
                category: 'DATA',
                metadata: { logCount: activityLogs.length },
                ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                userAgent: req.headers.get('User-Agent') || null
            })
        });
        return NextResponse.json(result);
    } catch (error) {
        console.error('Error in GET /api/admin/systemLogs:', error);
        return NextResponse.json({ error: 'Failed to fetch system logs' }, { status: 500 });
    }
}