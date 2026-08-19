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
 * The client's `update(data)` payload can ask this callback to re-sync the
 * credential fields from the database. A user who just changed their own password
 * holds a token snapshotted *before* the change, and the session callback revokes
 * exactly that (its `pwChangedAt` no longer matches). Refreshing here keeps the
 * active session alive while any *other* stale token still gets revoked.
 */
function isCredentialRefresh(session: unknown): boolean {
  return (
    typeof session === 'object' &&
    session !== null &&
    (session as { refreshCredentials?: unknown }).refreshCredentials === true
  );
}

/**
 * Build the JWT. Runs at sign-in (when `user` is present), on an explicit client
 * activity heartbeat (`trigger === 'update'`), and on ordinary token reads.
 */
export async function buildJwtToken({
  token,
  user,
  account,
  trigger,
  session,
}: {
  token: JWT;
  user?: User | null;
  /**
   * Which provider this sign-in came through, present only on the sign-in itself. Kept on the
   * token so signing out can say where the session came from: by then the provider is long out
   * of the picture, and a logout entry that cannot say what it ended is half a record.
   */
  account?: { provider?: string } | null;
  trigger?: 'signIn' | 'signUp' | 'update';
  // The data passed to the client-side `update(data)` call, forwarded by NextAuth.
  session?: unknown;
}): Promise<JWT> {
  // Sign-in only. This is the one place the database is read here; ordinary reads of an
  // existing token do no query at all.
  if (user) {
    token.id = user.id;
    if (account?.provider) token.provider = account.provider;
    /**
     * Read by id, not by the address the provider sent.
     *
     * Identity has already been resolved by this point: for institutional sign-in that is the
     * issuer and subject, and the account they resolve to may hold a different address than the
     * provider is asserting today. Looking the account up by that address found nothing after
     * somebody's institutional address changed, which lost their name and, worse, left
     * `pwChangedAt` null against an account that has a real `passwordChangedAt`, so the session
     * that had just been created was treated as revoked by the check in `buildSession`.
     */
    if (user.id) {
      const fullUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          firstName: true,
          lastName: true,
          passwordChangedAt: true,
          /**
           * What the account is, taken from the account.
           *
           * These used to be copied from the object the provider handed back, which works for
           * the password form (its `authorize` reads them from the database) and not at all for
           * institutional sign-in, where the object is built from the provider's profile and
           * has no notion of any of them. An administrator signing in through their institution
           * arrived with `isAdmin` undefined and was refused every administration page.
           *
           * They belong here regardless: what somebody may do is AFCT's to say, never a claim
           * an identity provider supplies.
           */
          isAdmin: true,
          avatar: true,
          // The column behind "must change password": an administrator-issued temporary one.
          temporaryPassword: true,
        },
      });
      token.firstName = fullUser?.firstName || undefined;
      token.lastName = fullUser?.lastName || undefined;
      // Absent only if the account went away mid sign-in, in which case granting nothing is
      // the safe reading.
      token.isAdmin = fullUser?.isAdmin ?? false;
      token.avatar = fullUser?.avatar ?? undefined;
      token.mustChangePassword = Boolean(fullUser?.temporaryPassword);
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

    // Re-sync the credential snapshot after the user changed their own password, so the
    // session that made the change survives instead of being revoked on the next request
    // (see isCredentialRefresh). Gated on the explicit marker so an ordinary idle
    // heartbeat never pays for this database read.
    if (isCredentialRefresh(session) && typeof token.id === 'string') {
      const fresh = await prisma.user.findUnique({
        where: { id: token.id },
        select: { temporaryPassword: true, passwordChangedAt: true },
      });
      if (fresh) {
        token.mustChangePassword = fresh.temporaryPassword;
        token.pwChangedAt = fresh.passwordChangedAt ? fresh.passwordChangedAt.getTime() : null;
      }
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
