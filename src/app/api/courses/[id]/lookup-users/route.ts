import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await params;
  const courseId = resolved.id;

  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const emails: string[] = (body?.emails ?? []).map((e: string) => String(e).trim().toLowerCase()).filter(Boolean);
    if (!emails.length) return NextResponse.json({ found: [], notFound: [] });

    // Find users whose email matches (case-insensitive)
    // Use OR with equals + mode: 'insensitive' so matching does not depend on DB collation.
    const users = await prisma.user.findMany({
      where: {
        OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' } })),
      },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    });

    const foundEmails = new Set(users.map((u) => u.email.toLowerCase()));
    const notFound = emails.filter((e) => !foundEmails.has(e));

    return NextResponse.json({ found: users, notFound }, { status: 200 });
  } catch (err) {
    console.error('lookup-users error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
