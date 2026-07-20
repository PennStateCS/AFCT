// src/lib/auth-callbacks.ts
//
// The NextAuth `jwt` and `session` callbacks, extracted from auth.ts.
//
// These two functions decide, on every authenticated request, who the caller is and
// what they are allowed to be. They carry several security controls a JWT cannot express
// on its own - account deletion, account disable, password-change revocation, admin
// demotion, idle expiry - and a bug in any of them affects the whole application.
//
// They live here rather than inline in auth.ts so they can be imported and called
// directly by tests. Importing auth.ts runs `NextAuth({...})` and `requireAuthSecret()`
// at module load, which a unit test would otherwise have to stub its way around.
import type { Session, User } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/session-user-cache';
import { isSessionIdleExpired } from '@/lib/session-timeout';
import { getServerIdleTimeoutMs } from '@/lib/session-timeout.server';
import { passwordChangedSinceToken } from '@/lib/session-password';

/**
 * Build the JWT. Runs at sign-in (when `user` is present), on an explicit client
 * activity heartbeat (`trigger === 'update'`), and on ordinary token reads.
 */
export async function buildJwtToken({
  token,
  user,
  trigger,
}: {
  token: JWT;
  user?: User | null;
  trigger?: 'signIn' | 'signUp' | 'update';
}): Promise<JWT> {
  // Sign-in only. This is the one place the database is read here; ordinary reads of an
  // existing token do no query at all.
  if (user) {
    token.isAdmin = user.isAdmin;
    token.id = user.id;
    token.avatar = user.avatar;
    token.mustChangePassword = Boolean(user.mustChangePassword);
    if (user.email) {
      const fullUser = await prisma.user.findUnique({
        where: { email: user.email },
        select: { firstName: true, lastName: true, passwordChangedAt: true },
      });
      token.firstName = fullUser?.firstName || undefined;
      token.lastName = fullUser?.lastName || undefined;
      // Snapshot the password-change instant so a later change/reset revokes this
      // token (see buildSession).
      token.pwChangedAt = fullUser?.passwordChangedAt
        ? fullUser.passwordChangedAt.getTime()
        : null;
    }
    // Start the idle clock at sign-in.
    token.lastActivity = Date.now();
    token.idleTimeoutMs = await getServerIdleTimeoutMs();
  }

  // Explicit activity heartbeat from the client (`update()`): refresh the idle clock,
  // but never revive a session that has already gone idle-expired. Without the guard, a
  // heartbeat arriving after the limit would resurrect a session that should be dead.
  if (trigger === 'update') {
    const now = Date.now();
    if (!isSessionIdleExpired(token.lastActivity, token.idleTimeoutMs, now)) {
      token.lastActivity = now;
      token.idleTimeoutMs = await getServerIdleTimeoutMs(now);
    }
  }

  // Backfill tokens issued before idle tracking existed so a deploy doesn't instantly
  // sign everyone out; treat them as active as of now.
  if (typeof token.lastActivity !== 'number') {
    token.lastActivity = Date.now();
  }
  if (typeof token.idleTimeoutMs !== 'number') {
    token.idleTimeoutMs = await getServerIdleTimeoutMs();
  }

  return token;
}

/**
 * Build the session handed to every server consumer.
 *
 * Deliberately re-reads the user rather than trusting the token, because the token
 * cannot know that the account was since deleted, disabled, de-admined, or had its
 * password reset.
 */
export async function buildSession({
  session,
  token,
}: {
  session: Session;
  token?: JWT | null;
}): Promise<Session> {
  if (!token) return session;

  session.user.id = token.id as string;
  session.user.isAdmin = Boolean(token.isAdmin);
  session.user.avatar = (token.avatar as string | null) || undefined;

  // Idle-timeout backstop mirroring the edge middleware: a token whose last activity is
  // older than its idle limit must not grant access. The client watcher normally signs
  // out first; this covers server-side consumers (`auth()`, the route wrappers) if it
  // doesn't. Returning early also avoids a pointless user read for a dead session.
  if (isSessionIdleExpired(token.lastActivity, token.idleTimeoutMs, Date.now())) {
    return revoke(session, token);
  }

  try {
    // Served from a seconds-long cache so one dashboard load's parallel API calls share
    // a single read. Deactivation, password changes and admin changes evict the entry,
    // so revocation stays effectively immediate; the TTL is only the backstop.
    // See lib/session-user-cache.
    const freshUser = await getSessionUser(token.id as string);

    // Revoke a session whose password changed after the token was issued (a
    // reset/change must terminate existing sessions, not just future ones).
    const stillValid =
      freshUser &&
      !freshUser.inactive &&
      !passwordChangedSinceToken(token.pwChangedAt, freshUser.passwordChangedAt);

    if (!stillValid) {
      // Gone, disabled, or password-revoked: strip privileges and mark the session
      // inactive so the auth wrappers reject it rather than trusting the stale token.
      return revoke(session, token);
    }

    session.user.firstName = freshUser.firstName || undefined;
    session.user.lastName = freshUser.lastName || undefined;
    session.user.isAdmin = freshUser.isAdmin;
    session.user.avatar = freshUser.avatar || undefined;
    session.user.mustChangePassword = freshUser.temporaryPassword;
    session.user.inactive = false;
    session.user.cropX = freshUser.cropX ?? undefined;
    session.user.cropY = freshUser.cropY ?? undefined;
    session.user.zoom = freshUser.zoom ?? undefined;
    session.user.name =
      `${freshUser.firstName || ''} ${freshUser.lastName || ''}`.trim() || undefined;
  } catch (error) {
    console.error('Error fetching fresh user data:', error);
    // On a transient DB error we fail OPEN for availability (keep the user signed in, a
    // blip shouldn't log everyone out) but CLOSED for privilege: strip admin. The
    // fresh-user lookup is also the admin-revocation path, so trusting the token's
    // isAdmin here would let a just-de-admined user keep elevated access during an
    // outage. Note this deliberately does NOT set `inactive`, which is what keeps it
    // "open": the user stays signed in, just unprivileged.
    session.user.isAdmin = false;
    session.user.firstName = token.firstName as string | undefined;
    session.user.lastName = token.lastName as string | undefined;
    session.user.mustChangePassword = Boolean(token.mustChangePassword);
  }

  return session;
}

/**
 * Strip a session down to a rejected one: no admin, flagged inactive, and only the
 * token's own (already-known) display fields. Every revocation path lands here so they
 * cannot drift apart - an `inactive` session that still carried `isAdmin` would be a
 * privilege leak.
 */
function revoke(session: Session, token: JWT): Session {
  session.user.isAdmin = false;
  session.user.inactive = true;
  session.user.firstName = token.firstName as string | undefined;
  session.user.lastName = token.lastName as string | undefined;
  session.user.mustChangePassword = Boolean(token.mustChangePassword);
  return session;
}
