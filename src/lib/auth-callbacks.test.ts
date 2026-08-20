import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

/**
 * The NextAuth session lifecycle.
 *
 * These two callbacks run on every authenticated request and carry several controls a
 * JWT cannot express by itself: account deletion, account disable, password-change
 * revocation, admin demotion, and idle expiry. The route wrappers that consume the
 * result were already well tested; the thing producing it was not.
 *
 * The behaviour worth pinning hardest is the failure mode: on a database error the
 * session must fail OPEN for availability (stay signed in) but CLOSED for privilege
 * (lose admin). Those pull in opposite directions and are easy to "simplify" wrongly.
 */

const prismaMock = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
const getSessionUserMock = vi.hoisted(() => vi.fn());
const idleTimeoutMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/session-user-cache', () => ({ getSessionUser: getSessionUserMock }));
vi.mock('@/lib/session-timeout.server', () => ({ getServerIdleTimeoutMs: idleTimeoutMock }));

// isSessionIdleExpired and passwordChangedSinceToken are pure and separately tested;
// using the real ones keeps these tests about real expiry/revocation decisions rather
// than about whether we called a stub.
import { buildJwtToken, buildSession } from './auth-callbacks';
import { ABSOLUTE_SESSION_MAX_AGE_MS } from './session-timeout';

const IDLE_MS = 30 * 60 * 1000;

const freshUser = (over: Record<string, unknown> = {}) => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  isAdmin: false,
  avatar: null,
  temporaryPassword: false,
  inactive: false,
  passwordChangedAt: null,
  cropX: null,
  cropY: null,
  zoom: null,
  ...over,
});

const makeToken = (over: Partial<JWT> = {}): JWT =>
  ({
    id: 'user-1',
    email: 'ada@example.com',
    isAdmin: false,
    firstName: 'Ada',
    lastName: 'Lovelace',
    lastActivity: Date.now(),
    idleTimeoutMs: IDLE_MS,
    authTime: Date.now(),
    pwChangedAt: null,
    ...over,
  }) as JWT;

const makeSession = (): Session =>
  ({ user: { id: '', email: 'ada@example.com', isAdmin: false }, expires: '' }) as Session;

const runSession = (token: Partial<JWT> = {}) =>
  buildSession({ session: makeSession(), token: makeToken(token) });

beforeEach(() => {
  vi.resetAllMocks();
  idleTimeoutMock.mockResolvedValue(IDLE_MS);
  getSessionUserMock.mockResolvedValue(freshUser());
  prismaMock.user.findUnique.mockResolvedValue({
    firstName: 'Ada',
    lastName: 'Lovelace',
    passwordChangedAt: null,
  });
});

describe('buildJwtToken', () => {
  it('seeds identity, the password snapshot, and the idle clock at sign-in', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      firstName: 'Ada',
      lastName: 'Lovelace',
      passwordChangedAt: new Date('2026-01-01T00:00:00Z'),
      isAdmin: true,
      avatar: null,
      temporaryPassword: true,
    });

    const token = await buildJwtToken({
      token: {} as JWT,
      user: {
        id: 'user-1',
        email: 'ada@example.com',
        isAdmin: true,
        mustChangePassword: true,
      } as never,
    });

    expect(token.id).toBe('user-1');
    expect(token.isAdmin).toBe(true);
    expect(token.mustChangePassword).toBe(true);
    expect(token.firstName).toBe('Ada');
    // The snapshot is what makes password-change revocation possible later.
    expect(token.pwChangedAt).toBe(new Date('2026-01-01T00:00:00Z').getTime());
    expect(token.idleTimeoutMs).toBe(IDLE_MS);
    expect(typeof token.lastActivity).toBe('number');
  });

  it('records a null password snapshot for an account that never changed its password', async () => {
    const token = await buildJwtToken({
      token: {} as JWT,
      user: { id: 'user-1', email: 'ada@example.com', isAdmin: false } as never,
    });
    expect(token.pwChangedAt).toBeNull();
  });

  it('does not query the database on an ordinary token read', async () => {
    // Every authenticated request passes through here; a query would be a per-request
    // database hit on the hottest path in the app.
    await buildJwtToken({ token: makeToken() });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('advances the idle clock on an activity heartbeat', async () => {
    const stale = Date.now() - 60_000;
    const token = await buildJwtToken({
      token: makeToken({ lastActivity: stale }),
      trigger: 'update',
    });
    expect(token.lastActivity).toBeGreaterThan(stale);
  });

  it('refuses to revive an already idle-expired session on a heartbeat', async () => {
    // Otherwise a background tab's ping could resurrect a session that has already
    // timed out, defeating the idle limit entirely.
    const expired = Date.now() - (IDLE_MS + 60_000);
    const token = await buildJwtToken({
      token: makeToken({ lastActivity: expired }),
      trigger: 'update',
    });
    expect(token.lastActivity).toBe(expired);
  });

  it('re-syncs the credential snapshot when the update asks for it', async () => {
    // After a user changes their own password, the client calls update({ refreshCredentials
    // }); the token must pick up the new passwordChangedAt and cleared temporaryPassword,
    // or the session callback would revoke the very session that made the change.
    const changedAt = new Date('2026-03-01T00:00:00Z');
    prismaMock.user.findUnique.mockResolvedValue({
      temporaryPassword: false,
      passwordChangedAt: changedAt,
    });

    const token = await buildJwtToken({
      token: makeToken({ pwChangedAt: null, mustChangePassword: true }),
      trigger: 'update',
      session: { refreshCredentials: true },
    });

    expect(token.pwChangedAt).toBe(changedAt.getTime());
    expect(token.mustChangePassword).toBe(false);
  });

  it('does not read the database on an ordinary heartbeat update', async () => {
    // The refresh is gated on the explicit marker; the frequent idle heartbeat must stay
    // query-free.
    await buildJwtToken({
      token: makeToken(),
      trigger: 'update',
      session: { activity: Date.now() },
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('backfills a legacy token that predates idle tracking instead of expiring it', async () => {
    // A deploy must not sign everyone out because their tokens lack the new fields.
    const token = await buildJwtToken({
      token: { id: 'user-1', email: 'ada@example.com', isAdmin: false } as JWT,
    });
    expect(typeof token.lastActivity).toBe('number');
    expect(token.idleTimeoutMs).toBe(IDLE_MS);
  });
});

describe('buildSession', () => {
  it('reflects the current database record, not the token', async () => {
    getSessionUserMock.mockResolvedValue(
      freshUser({ firstName: 'Grace', lastName: 'Hopper', isAdmin: true }),
    );

    const session = await runSession({ isAdmin: false, firstName: 'Stale' });

    expect(session.user.isAdmin).toBe(true);
    expect(session.user.firstName).toBe('Grace');
    expect(session.user.name).toBe('Grace Hopper');
    expect(session.user.inactive).toBe(false);
  });

  it('revokes a session whose account was deleted', async () => {
    getSessionUserMock.mockResolvedValue(null);

    const session = await runSession({ isAdmin: true });

    expect(session.user.inactive).toBe(true);
    expect(session.user.isAdmin).toBe(false);
  });

  it('revokes a session whose account was disabled', async () => {
    getSessionUserMock.mockResolvedValue(freshUser({ inactive: true, isAdmin: true }));

    const session = await runSession({ isAdmin: true });

    expect(session.user.inactive).toBe(true);
    expect(session.user.isAdmin).toBe(false);
  });

  it('revokes a session issued before a password change', async () => {
    // A reset must terminate sessions that already exist, not just refuse new ones.
    getSessionUserMock.mockResolvedValue(
      freshUser({ passwordChangedAt: new Date('2026-02-01T00:00:00Z') }),
    );

    const session = await runSession({
      pwChangedAt: new Date('2026-01-01T00:00:00Z').getTime(),
    });

    expect(session.user.inactive).toBe(true);
    expect(session.user.isAdmin).toBe(false);
  });

  it('keeps a session whose snapshot still matches the account', async () => {
    const changedAt = new Date('2026-01-01T00:00:00Z');
    getSessionUserMock.mockResolvedValue(freshUser({ passwordChangedAt: changedAt }));

    const session = await runSession({ pwChangedAt: changedAt.getTime() });

    expect(session.user.inactive).toBe(false);
  });

  it('keeps a session for an account that has never changed its password', async () => {
    // Both sides read as null, so tokens issued before this feature existed are not
    // spuriously revoked on deploy.
    getSessionUserMock.mockResolvedValue(freshUser({ passwordChangedAt: null }));
    const session = await runSession({ pwChangedAt: null });
    expect(session.user.inactive).toBe(false);
  });

  it('revokes on any snapshot mismatch, including one that looks newer than the account', async () => {
    // The check is exact-match, not "is the account newer". A token claiming a later
    // password change than the account actually has means something is wrong (a restore
    // from backup, a hand-edited row, a clock problem), and the safe reading of "wrong"
    // on a credential check is revoke.
    getSessionUserMock.mockResolvedValue(
      freshUser({ passwordChangedAt: new Date('2026-01-01T00:00:00Z') }),
    );

    const session = await runSession({
      pwChangedAt: new Date('2026-02-01T00:00:00Z').getTime(),
    });

    expect(session.user.inactive).toBe(true);
    expect(session.user.isAdmin).toBe(false);
  });

  it('drops admin as soon as the flag is removed in the database', async () => {
    getSessionUserMock.mockResolvedValue(freshUser({ isAdmin: false }));
    const session = await runSession({ isAdmin: true });
    expect(session.user.isAdmin).toBe(false);
  });

  it('rejects an idle-expired token without even reading the user', async () => {
    const session = await runSession({
      lastActivity: Date.now() - (IDLE_MS + 60_000),
      isAdmin: true,
    });

    expect(session.user.inactive).toBe(true);
    expect(session.user.isAdmin).toBe(false);
    expect(getSessionUserMock).not.toHaveBeenCalled();
  });

  /**
   * The cap the idle check cannot enforce. `lastActivity` is deliberately now, so the only
   * thing that can end this session is its age, which is the whole point of stamping
   * `authTime` at sign-in and never moving it afterwards.
   */
  it('rejects a session older than the absolute limit however active it is', async () => {
    const session = await runSession({
      authTime: Date.now() - (ABSOLUTE_SESSION_MAX_AGE_MS + 60_000),
      lastActivity: Date.now(),
      isAdmin: true,
    });

    expect(session.user.inactive).toBe(true);
    expect(session.user.isAdmin).toBe(false);
  });

  it('keeps a session that is still inside the absolute limit', async () => {
    const session = await runSession({
      authTime: Date.now() - (ABSOLUTE_SESSION_MAX_AGE_MS - 60_000),
    });

    expect(session.user.inactive).toBe(false);
    expect(session.user.id).toBe('user-1');
  });

  // A token issued before this existed carries no authTime, and a deploy must not sign
  // everyone out.
  it('keeps a token that predates absolute-limit tracking', async () => {
    const session = await runSession({ authTime: undefined });
    expect(session.user.inactive).toBe(false);
  });

  describe('when the database read fails', () => {
    beforeEach(() => {
      getSessionUserMock.mockRejectedValue(new Error('database down'));
    });

    it('keeps the user signed in (fails open for availability)', async () => {
      const session = await runSession();
      // A blip must not log everyone out.
      expect(session.user.inactive).toBeFalsy();
      expect(session.user.id).toBe('user-1');
    });

    it('strips admin (fails closed for privilege)', async () => {
      // The fresh-user read IS the admin-revocation path, so trusting the token here
      // would let a just-de-admined user keep elevated access for the whole outage.
      const session = await runSession({ isAdmin: true });
      expect(session.user.isAdmin).toBe(false);
    });

    it('falls back to the token for display fields', async () => {
      const session = await runSession({ firstName: 'Ada', mustChangePassword: true });
      expect(session.user.firstName).toBe('Ada');
      expect(session.user.mustChangePassword).toBe(true);
    });
  });

  it('never reports an inactive session that still carries admin', async () => {
    // The invariant behind every revocation path: whatever the reason, a rejected
    // session must not keep privileges. Checked across all of them at once so a new
    // revocation branch cannot quietly skip the isAdmin reset.
    const cases: Array<[string, () => Promise<Session>]> = [
      [
        'deleted',
        () => {
          getSessionUserMock.mockResolvedValue(null);
          return runSession({ isAdmin: true });
        },
      ],
      [
        'disabled',
        () => {
          getSessionUserMock.mockResolvedValue(freshUser({ inactive: true }));
          return runSession({ isAdmin: true });
        },
      ],
      [
        'password changed',
        () => {
          getSessionUserMock.mockResolvedValue(freshUser({ passwordChangedAt: new Date(2e12) }));
          return runSession({ isAdmin: true, pwChangedAt: 1e12 });
        },
      ],
      [
        'idle expired',
        () =>
          runSession({ isAdmin: true, lastActivity: Date.now() - (IDLE_MS + 60_000) }),
      ],
    ];

    for (const [label, run] of cases) {
      const session = await run();
      expect(session.user.inactive, label).toBe(true);
      expect(session.user.isAdmin, label).toBe(false);
    }
  });

  it('returns the session untouched when there is no token', async () => {
    const session = await buildSession({ session: makeSession(), token: null });
    expect(session.user.id).toBe('');
    expect(getSessionUserMock).not.toHaveBeenCalled();
  });
});

/**
 * What somebody may do comes from their AFCT account, never from the provider that signed them
 * in. These fields used to be copied off the object the provider handed back, which the password
 * form fills in from the database and an institutional sign-in does not fill in at all: an
 * administrator arriving through their institution had `isAdmin` undefined and was refused every
 * administration page, with a session that was otherwise perfectly valid.
 */
describe('privileges on a session', () => {
  it('reads them from the account when the provider says nothing', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      firstName: 'Ada',
      lastName: 'Lovelace',
      passwordChangedAt: null,
      isAdmin: true,
      avatar: 'ada.png',
      temporaryPassword: false,
    });

    // What Auth.js builds from an OIDC profile: an id and an address, nothing else.
    const token = await buildJwtToken({
      token: {} as JWT,
      user: { id: 'user-1', email: 'ada@example.com' } as never,
    });

    expect(token.isAdmin).toBe(true);
    expect(token.avatar).toBe('ada.png');
    expect(token.mustChangePassword).toBe(false);
  });

  it('does not take the provider at its word', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      firstName: 'Ada',
      lastName: 'Lovelace',
      passwordChangedAt: null,
      isAdmin: false,
      avatar: null,
      temporaryPassword: false,
    });

    const token = await buildJwtToken({
      token: {} as JWT,
      // A profile claiming to be an administrator. The account says otherwise, and the account
      // is the authority.
      user: { id: 'user-1', email: 'ada@example.com', isAdmin: true } as never,
    });

    expect(token.isAdmin).toBe(false);
  });

  it('grants nothing when the account has gone', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const token = await buildJwtToken({
      token: {} as JWT,
      user: { id: 'user-1', email: 'ada@example.com', isAdmin: true } as never,
    });

    expect(token.isAdmin).toBe(false);
  });
});
