import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * The moment two sign-ins attach the same identity at once.
 *
 * Both read nothing, both create, and the constraint refuses one of them. Which branch runs
 * depends on the exact order of four database calls, which a real race decides for itself, so
 * the sequence is driven here instead: the database tests next door prove the constraint, and
 * these prove what AFCT does when it fires.
 */

const prismaStub = vi.hoisted(() => ({
  linkedIdentity: { findUnique: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
  activityLog: { create: vi.fn(async () => ({})) },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaStub }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: vi.fn(async () => {}) }));

const { linkIdentity } = await import('@/lib/linked-identity');

const REF = { kind: 'OIDC' as const, issuer: 'https://idp.test', subject: 'sub-1' };
const CONTEXT = { ipAddress: '10.0.0.1', userAgent: 'test' };

const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });

const link = (userId = 'u-1') =>
  linkIdentity({ ref: REF, userId, via: 'AUTO_VERIFIED_EMAIL', actorUserId: userId, context: CONTEXT });

beforeEach(() => {
  vi.clearAllMocks();
  // Nothing attached when this request looks, and an ordinary account to attach it to.
  prismaStub.linkedIdentity.findUnique.mockResolvedValue(null);
  prismaStub.user.findUnique.mockResolvedValue({ isAdmin: false, inactive: false });
});

describe('when another request attached the identity first', () => {
  it('accepts it as already ours', async () => {
    prismaStub.linkedIdentity.create.mockRejectedValueOnce(duplicate());
    // The row the winner wrote, read after the refusal.
    prismaStub.linkedIdentity.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      userId: 'u-1',
    });

    await expect(link()).resolves.toEqual({ ok: true, created: false });
  });

  it('refuses when it now belongs to somebody else', async () => {
    prismaStub.linkedIdentity.create.mockRejectedValueOnce(duplicate());
    prismaStub.linkedIdentity.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      userId: 'somebody-else',
    });

    await expect(link()).resolves.toEqual({ ok: false, reason: 'already-linked-elsewhere' });
  });

  /**
   * The constraint said the row exists, so its absence is not a race: answering "already
   * linked" would describe a state that is not there, and hide whatever is actually wrong.
   */
  it('surfaces the fault when the row it was told about is missing', async () => {
    prismaStub.linkedIdentity.create.mockRejectedValueOnce(duplicate());
    prismaStub.linkedIdentity.findUnique.mockResolvedValue(null);

    await expect(link()).rejects.toMatchObject({ code: 'P2002' });
  });

  it('lets any other database failure travel unchanged', async () => {
    prismaStub.linkedIdentity.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('gone', { code: 'P1001', clientVersion: 'test' }),
    );

    await expect(link()).rejects.toMatchObject({ code: 'P1001' });
    // And it did not go looking for a row to report success with.
    expect(prismaStub.linkedIdentity.findUnique).toHaveBeenCalledTimes(1);
  });

  /**
   * Inside somebody else's transaction the recovery is not ours to make: Postgres has already
   * aborted it, so the read would fail too and the caller must decide what to do.
   */
  it('does not try to recover inside a caller transaction', async () => {
    const tx = {
      linkedIdentity: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      user: { findUnique: vi.fn().mockResolvedValue({ isAdmin: false, inactive: false }) },
    };
    tx.linkedIdentity.create.mockRejectedValueOnce(duplicate());

    await expect(
      linkIdentity({
        ref: REF,
        userId: 'u-1',
        via: 'AUTO_VERIFIED_EMAIL',
        actorUserId: 'u-1',
        context: CONTEXT,
        tx: tx as never,
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // One read, the one before the insert: no recovery was attempted.
    expect(tx.linkedIdentity.findUnique).toHaveBeenCalledTimes(1);
  });
});
