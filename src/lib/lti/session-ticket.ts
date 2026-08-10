/**
 * Turning a verified launch into a session.
 *
 * The launch endpoint verifies the token but does not create the session: sessions are minted by
 * NextAuth, and having two ways to make one is how they end up differing. So the launch hands
 * out a single-use ticket and this spends it.
 *
 * The ticket is only ever a pointer to a decision already made. It proves nothing about the
 * person on its own, which is why it lives for a minute and dies on first use.
 */

import { prisma } from '@/lib/prisma';
import { consumeSingleUseToken } from '@/lib/single-use-token';

export type TicketUser = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  avatar?: string;
  mustChangePassword: boolean;
};

/** Spend a ticket and return whose session it makes, or null if it is not good. */
export async function redeemSessionTicket(ticket: string | undefined): Promise<TicketUser | null> {
  if (!ticket) return null;

  const spent = await consumeSingleUseToken({ token: ticket, purpose: 'LTI_SESSION_TICKET' });
  if (!spent?.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: spent.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isAdmin: true,
      avatar: true,
      temporaryPassword: true,
      inactive: true,
    },
  });

  // Re-checked rather than assumed: an account can be switched off between the launch and the
  // ticket being spent, and a minute is long enough for that to matter.
  if (!user || user.inactive) return null;

  return {
    id: user.id,
    email: user.email,
    name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    isAdmin: user.isAdmin,
    avatar: user.avatar || undefined,
    // Same mapping the password path uses. Always false for an account with no password.
    mustChangePassword: user.temporaryPassword,
  };
}
