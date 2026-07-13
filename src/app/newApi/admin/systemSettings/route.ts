import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { COMMON_TIMEZONES } from '@/lib/timezones';

import {
  clampSessionTimeoutMinutes,
  DEFAULT_ALLOW_SIGNUP,
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DEFAULT_SYSTEM_TIMEZONE,
} from '@/lib/system-settings';


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
                    action: 'FETCH_SYSTEM_SETTINGS_FAILED',
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
                    action: 'FETCH_SYSTEM_SETTINGS_FAILED',
                    category: 'AUTH',
                    metadata: { reason: 'Unauthorized access' },
                    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                    userAgent: req.headers.get('User-Agent') || null
                })
            });
            return NextResponse.json({ error: 'Unauthorized Access' }, { status: 403 });
        }

        // Fetch system settings
        const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });

        // Log and return successful GET
        await fetch('/api/createActivityLog', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: session.user.id,
                action: 'FETCH_SYSTEM_SETTINGS_SUCCESS',
                category: 'SYSTEM_SETTINGS',
                metadata: { settings },
                ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                userAgent: req.headers.get('User-Agent') || null
            })
        });

        return NextResponse.json({
            timezone: settings?.timezone ?? DEFAULT_SYSTEM_TIMEZONE,
            maxUploadSizeMb: settings?.maxUploadSizeMb ?? DEFAULT_MAX_UPLOAD_SIZE_MB,
            allowSignup: settings?.allowSignup ?? DEFAULT_ALLOW_SIGNUP,
            sessionTimeoutMinutes: settings?.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
        });
    } catch (error) {
        console.error('Error in GET /api/admin/systemSettings:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}


export async function PUT(req: NextRequest) {
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
                    action: 'PUT_SYSTEM_SETTINGS_FAILED',
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
                    action: 'PUT_SYSTEM_SETTINGS_FAILED',
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
        const timezone = String(body.timezone ?? '').trim();
        const rawSize = Number(body.maxUploadSizeMb);
        const maxUploadSizeMb = Math.max(
            1,
            Math.min(1024, Number.isFinite(rawSize) ? Math.trunc(rawSize) : 0),
        );
        const sessionTimeoutMinutes = clampSessionTimeoutMinutes(Number(body.sessionTimeoutMinutes));
        const hasAllowSignup = typeof body.allowSignup === 'boolean';

        // Validate timezone
        if (!COMMON_TIMEZONES.includes(timezone as (typeof COMMON_TIMEZONES)[number])) {
            return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
        }

        // Prepare update and create data
        const updateData: {
            timezone: string;
            maxUploadSizeMb: number;
            sessionTimeoutMinutes: number;
            allowSignup?: boolean;
        } = {
            timezone,
            maxUploadSizeMb,
            sessionTimeoutMinutes,
        };

        // Prepare data
        if (hasAllowSignup) {
            updateData.allowSignup = body.allowSignup;
        }

        // Create data
        const createData: {
            id: number;
            timezone: string;
            maxUploadSizeMb: number;
            sessionTimeoutMinutes: number;
            allowSignup?: boolean;
        } = {
            id: 1,
            timezone,
            maxUploadSizeMb,
            sessionTimeoutMinutes,
        };

        // Add allowSignup if present
        if (hasAllowSignup) {
            createData.allowSignup = body.allowSignup;
        }

        // Upsert system settings
        const settings = await prisma.systemSettings.upsert({
            where: { id: 1 },
            update: updateData,
            create: createData,
        });

        // Log and return successful PUT
        await fetch('/api/createActivityLog', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: session.user.id,
                action: 'PUT_SYSTEM_SETTINGS_SUCCESS',
                category: 'SYSTEM_SETTINGS',
                metadata: { settings },
                ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || null,
                userAgent: req.headers.get('User-Agent') || null
            })
        });
        return NextResponse.json({
            timezone: settings.timezone,
            maxUploadSizeMb: settings.maxUploadSizeMb,
            allowSignup: settings.allowSignup,
            sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
        });
    } catch (error) {
        console.error('Error in PUT /api/admin/systemSettings:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}