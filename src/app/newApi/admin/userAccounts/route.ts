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
                    action: 'FETCH_USER_ACCOUNTS_FAILED',
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
                    action: 'FETCH_USER_ACCOUNTS_FAILED',
                    category: 'AUTH',
                    metadata: { reason: 'Unauthorized access' },
                    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                    userAgent: req.headers.get('User-Agent') || null
                })
            });
            return NextResponse.json({ error: 'Unauthorized Access' }, { status: 403 });
        }

        // Fetch user accounts
        const userAccounts = await prisma.user.findMany({
            orderBy: [{ isAdmin: 'desc' }, { lastName: 'asc' }],
            select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            temporaryPassword: true,
            isAdmin: true,
            avatar: true,
            timezone: true,
            inactive: true,
            createdAt: true,
            updatedAt: true,
            },
        });

        // Log and return successful GET
        await fetch('/api/createActivityLog', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: session.user.id,
                action: 'FETCH_USER_ACCOUNTS_SUCCESS',
                category: 'USER_ACCOUNTS',
                metadata: { userAccounts },
                ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                userAgent: req.headers.get('User-Agent') || null
            })
        });
        return NextResponse.json({ userAccounts });
    } catch (error) {
        console.error('Error in GET /api/admin/userAccounts:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}