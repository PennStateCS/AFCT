import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Reports whether an email is already registered, so the signup form can warn
 * before submitting. Unauthenticated by design; it therefore leaks account
 * existence, which is an accepted trade-off for signup UX.
 * @openapi
 * summary: Check whether an email is registered
 * parameters:
 *   - { name: email, in: query, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Whether a user with that email exists.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             exists: { type: boolean }
 *   400: { description: The email query parameter is missing. }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email')?.trim().toLowerCase() || null;

  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  // Existence check only — never select anything sensitive here.
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  return NextResponse.json({ exists: !!existingUser });
}
