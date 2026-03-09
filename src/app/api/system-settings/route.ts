import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { COMMON_TIMEZONES } from '@/lib/timezones';

export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !['ADMIN', 'FACULTY'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return NextResponse.json({
    timezone: settings?.timezone ?? 'UTC',
    maxUploadSizeMb: settings?.maxUploadSizeMb ?? 25,
    allowSignup: settings?.allowSignup ?? true,
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !['ADMIN', 'FACULTY'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: { timezone?: string; maxUploadSizeMb?: number; allowSignup?: boolean };
  try {
    body = (await req.json()) as {
      timezone?: string;
      maxUploadSizeMb?: number;
      allowSignup?: boolean;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const timezone = String(body.timezone ?? '').trim();
  const rawSize = Number(body.maxUploadSizeMb);
  const maxUploadSizeMb = Math.max(
    1,
    Math.min(1024, Number.isFinite(rawSize) ? Math.trunc(rawSize) : 0),
  );
  const hasAllowSignup = typeof body.allowSignup === 'boolean';

  if (!COMMON_TIMEZONES.includes(timezone as (typeof COMMON_TIMEZONES)[number])) {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
  }

  const updateData: { timezone: string; maxUploadSizeMb: number; allowSignup?: boolean } = {
    timezone,
    maxUploadSizeMb,
  };
  if (hasAllowSignup) updateData.allowSignup = body.allowSignup;

  const createData: {
    id: number;
    timezone: string;
    maxUploadSizeMb: number;
    allowSignup?: boolean;
  } = {
    id: 1,
    timezone,
    maxUploadSizeMb,
  };
  if (hasAllowSignup) createData.allowSignup = body.allowSignup;

  const settings = await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: updateData,
    create: createData,
  });

  return NextResponse.json({
    timezone: settings.timezone,
    maxUploadSizeMb: settings.maxUploadSizeMb,
    allowSignup: settings.allowSignup,
  });
}
