import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { unlinkIdentity } from '@/lib/linked-identity';

/**
 * Disconnect one of the caller's own institutional sign-ins.
 *
 * Refuses to remove the last way into an account. Somebody with no password whose only
 * identity is this one would be locked out by their own click, and recovering that needs an
 * administrator, so it is worth one refusal here. `unlinkIdentity` is scoped to the owning
 * account, so an id belonging to somebody else removes nothing rather than removing theirs.
 * @openapi
 * summary: Disconnect an institutional sign-in from my account
 * responses:
 *   200: { description: The identity was disconnected. }
 *   401: { description: Not signed in. }
 *   404: { description: No such identity on this account. }
 *   409: { description: "That is the only way to sign in to this account." }
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;

  /**
   * The rule lives in `unlinkIdentity`, where the count and the delete are one serializable
   * decision. Checking here first and deleting afterwards let two requests removing different
   * identities at the same moment both pass, and leave an account with no way in at all.
   */
  const outcome = await unlinkIdentity({
    id,
    userId,
    actorUserId: userId,
    context: request,
  });

  if (outcome === 'last-way-in') {
    return NextResponse.json(
      {
        error:
          'This is the only way to sign in to your account. Set a password first, then you can disconnect it.',
      },
      { status: 409 },
    );
  }

  if (outcome === 'not-found') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
