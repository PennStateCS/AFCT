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
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !['ADMIN', 'FACULTY'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: { timezone?: string; maxUploadSizeMb?: number };
  try {
    body = (await req.json()) as { timezone?: string; maxUploadSizeMb?: number };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const timezone = String(body.timezone ?? '').trim();
  const rawSize = Number(body.maxUploadSizeMb);
  const maxUploadSizeMb = Math.max(1, Math.min(1024, Number.isFinite(rawSize) ? Math.trunc(rawSize) : 0));

  if (!COMMON_TIMEZONES.includes(timezone)) {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
  }

  const settings = await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: { timezone, maxUploadSizeMb },
    create: { id: 1, timezone, maxUploadSizeMb },
  });

  return NextResponse.json({
    timezone: settings.timezone,
    maxUploadSizeMb: settings.maxUploadSizeMb,
  });
}
