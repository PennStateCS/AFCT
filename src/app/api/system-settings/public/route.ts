import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return NextResponse.json({
    timezone: settings?.timezone ?? 'UTC',
    allowSignup: settings?.allowSignup ?? true,
  });
}
