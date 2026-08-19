import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AUTOMATIC, findUserByIdentity, linkIdentity, listIdentitiesForUser, recordIdentitySignIn, unlinkIdentity } from './linked-identity';

/**
 * Linked identities, against a real Postgres.
 *
 * Two things here are database properties rather than code ones: the identity is unique across
 * the whole table, and deleting an account takes its sign-ins with it. Both are the kind of
 * guarantee a mock will happily agree to while the database does something else.
 *
 * The guardrails are tested here too, because the thing being guarded is a row that must not
 * come into existence, and "it did not get created" is only meaningful against a real table.
 */

const SUFFIX = 'lidint';
const ids = { user: `u-${SUFFIX}`, other: `u2-${SUFFIX}`, admin: `ua-${SUFFIX}` };

const ISSUER = 'https://idp.example.test';
/** Stands in for a request, which the audit trail needs and these tests do not otherwise have. */
const CONTEXT = { ipAddress: '10.0.0.1', userAgent: 'test' };
const ref = (subject = 'sub-1') => ({ kind: 'OIDC' as const, issuer: ISSUER, subject });

async function destroyFixtures() {
  await prisma.linkedIdentity.deleteMany({ where: { issuer: ISSUER } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
}

async function seedFixtures() {
  await prisma.user.createMany({
    data: [
      { id: ids.user, email: `${SUFFIX}@example.test`, password: 'not-a-real-hash' },
      { id: ids.other, email: `${SUFFIX}-other@example.test`, password: 'not-a-real-hash' },
      {
        id: ids.admin,
        email: `${SUFFIX}-admin@example.test`,
        password: 'not-a-real-hash',
        isAdmin: true,
      },
    ],
  });
}

beforeEach(async () => {
  await destroyFixtures();
  await seedFixtures();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('linking', () => {
  it('attaches an identity to an account', async () => {
    const result = await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });

    expect(result).toEqual({ ok: true, created: true });
    expect((await findUserByIdentity(ref()))?.userId).toBe(ids.user);
  });

  // A repeated sign-in must not be an error.
  it('is idempotent for the account that already owns it', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });

    const again = await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });

    expect(again).toEqual({ ok: true, created: false });
    expect(await prisma.linkedIdentity.count({ where: { issuer: ISSUER } })).toBe(1);
  });

  /**
   * Moving an identity between accounts would hand one person's work to another, so it needs a
   * person to look at it rather than happening as a side effect of signing in.
   */
  it('refuses an identity that already belongs to someone else', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });

    const result = await linkIdentity({
      ref: ref(),
      userId: ids.other,
      via: 'AUTO_VERIFIED_EMAIL',
      actorUserId: ids.other,
      context: CONTEXT,
    });

    expect(result).toEqual({ ok: false, reason: 'already-linked-elsewhere' });
    expect((await findUserByIdentity(ref()))?.userId).toBe(ids.user);
  });

  it('refuses to attach anything to a disabled account', async () => {
    await prisma.user.update({ where: { id: ids.user }, data: { inactive: true } });

    const result = await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });

    expect(result).toEqual({ ok: false, reason: 'account-inactive' });
  });
});

/**
 * The guardrail that matters most. A provider that lets people set their own email address
 * would otherwise be a path straight to an administrator account, which is the worst outcome
 * available in this whole feature.
 */
describe('administrator accounts', () => {
  it('refuses an automatic link to an administrator', async () => {
    for (const via of ['AUTO_VERIFIED_EMAIL', 'JUST_IN_TIME'] as const) {
      const result = await linkIdentity({
        ref: ref(via),
        userId: ids.admin,
        via,
        actorUserId: ids.admin,
        context: CONTEXT,
      });

      expect(result).toEqual({ ok: false, reason: 'admin-requires-deliberate-link' });
    }
    expect(await prisma.linkedIdentity.count({ where: { userId: ids.admin } })).toBe(0);
  });

  // The rule is about automatic linking, not about administrators. An admin attaching their own
  // identity deliberately is exactly how they are meant to get one.
  it('allows an administrator to link deliberately', async () => {
    const self = await linkIdentity({
      ref: ref('a'),
      userId: ids.admin,
      via: 'SELF_SERVICE',
      actorUserId: ids.admin,
      context: CONTEXT,
    });
    const byAdmin = await linkIdentity({
      ref: ref('b'),
      userId: ids.admin,
      via: 'ADMIN',
      actorUserId: ids.admin,
      context: CONTEXT,
    });

    expect(self).toEqual({ ok: true, created: true });
    expect(byAdmin).toEqual({ ok: true, created: true });
  });
});

describe('the unique identity', () => {
  /**
   * The database, not the code, is what stops one identity reaching two accounts. Two sign-ins
   * racing would both pass a read-then-write check.
   */
  it('cannot be inserted twice, even bypassing the library', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });

    await expect(
      prisma.linkedIdentity.create({
        data: {
          kind: 'OIDC',
          issuer: ISSUER,
          subject: 'sub-1',
          userId: ids.other,
          linkedVia: 'ADMIN',
        },
      }),
    ).rejects.toThrow();
  });

  // Same subject at a different provider is a different person as far as we can tell.
  it('is scoped to the issuer, so the same subject elsewhere is separate', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });

    const result = await linkIdentity({
      ref: { kind: 'LTI', issuer: 'https://canvas.example.test', subject: 'sub-1' },
      userId: ids.other,
      via: 'SELF_SERVICE',
      actorUserId: ids.other,
      context: CONTEXT,
    });

    expect(result).toEqual({ ok: true, created: true });
  });
});

describe('unlinking', () => {
  it('detaches an identity from its account', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });
    const [link] = await listIdentitiesForUser(ids.user);

    expect(
      await unlinkIdentity({
        id: link!.id,
        userId: ids.user,
        actorUserId: ids.user,
        context: CONTEXT,
      }),
    ).toBe('removed');
    expect(await findUserByIdentity(ref())).toBeNull();
  });

  // Scoped to the owner, so a caller passing an id it does not own removes nothing.
  it('will not remove an identity belonging to another account', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });
    const [link] = await listIdentitiesForUser(ids.user);

    expect(
      await unlinkIdentity({
        id: link!.id,
        userId: ids.other,
        actorUserId: ids.other,
        context: CONTEXT,
      }),
      // Not found rather than removed: the id belongs to somebody else, and the outcome now
      // says which of the three things happened rather than just "no".
    ).toBe('not-found');
    expect(await findUserByIdentity(ref())).not.toBeNull();
  });
});

/**
 * A link outliving its account would be an identity resolving to nothing, and the next person
 * given that email address should not inherit it.
 */
describe('the cascade', () => {
  it('removes identities when the account is deleted', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });

    await prisma.user.delete({ where: { id: ids.user } });

    expect(await findUserByIdentity(ref())).toBeNull();
  });
});

describe('recording a sign-in', () => {
  it('notes when an identity was last used', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });
    const [link] = await listIdentitiesForUser(ids.user);
    expect(link!.lastSignInAt).toBeNull();

    await recordIdentitySignIn(link!.id);

    const [updated] = await listIdentitiesForUser(ids.user);
    expect(updated!.lastSignInAt).not.toBeNull();
  });

  // Best-effort: a sign-in that has otherwise succeeded must not fail on a bookkeeping write.
  it('does not throw for an identity that no longer exists', async () => {
    await expect(recordIdentitySignIn('does-not-exist')).resolves.toBeUndefined();
  });
});

/**
 * Linking changes who can sign in as an account, and for a student that is who can reach their
 * records. It is an education-record disclosure under FERPA, so it is logged with the actor,
 * the subject, and a severity that reflects what happened.
 */
describe('the audit trail', () => {
  const entries = (action: string) =>
    prisma.activityLog.findMany({ where: { action }, orderBy: { timestamp: 'desc' } });

  beforeEach(async () => {
    await prisma.activityLog.deleteMany({
      where: { action: { in: ['IDENTITY_LINKED', 'IDENTITY_UNLINKED', 'IDENTITY_LINK_DENIED'] } },
    });
  });

  it('records a link with who did it and whose account it was', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'ADMIN',
      // The case a defaulted actor would get wrong: an administrator acting on someone else.
      actorUserId: ids.admin,
      context: CONTEXT,
    });

    const [entry] = await entries('IDENTITY_LINKED');
    expect(entry?.userId).toBe(ids.admin);
    expect(entry?.metadata).toMatchObject({ targetUserId: ids.user, issuer: ISSUER });
  });

  it('records a refusal as a security event', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.admin,
      via: 'AUTO_VERIFIED_EMAIL',
      actorUserId: ids.admin,
      context: CONTEXT,
    });

    const [entry] = await entries('IDENTITY_LINK_DENIED');
    expect(entry?.severity).toBe('SECURITY');
    expect(entry?.metadata).toMatchObject({ reason: 'admin-requires-deliberate-link' });
  });

  it('records an unlink', async () => {
    await linkIdentity({
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });
    const [link] = await listIdentitiesForUser(ids.user);

    await unlinkIdentity({
      id: link!.id,
      userId: ids.user,
      actorUserId: ids.user,
      context: CONTEXT,
    });

    expect(await entries('IDENTITY_UNLINKED')).toHaveLength(1);
  });

  // A repeated sign-in through an identity that is already attached is not a change, and
  // logging it would bury the links that are.
  it('does not record anything when the link already exists', async () => {
    const args = {
      ref: ref(),
      userId: ids.user,
      via: 'SELF_SERVICE' as const,
      actorUserId: ids.user,
      context: CONTEXT,
    };
    await linkIdentity(args);
    await linkIdentity(args);

    expect(await entries('IDENTITY_LINKED')).toHaveLength(1);
  });
});

/**
 * "Administrators are never attached automatically" has two halves, and only one of them was
 * enforced. Linking read the account's standing and then inserted; a promotion committing in
 * between left an automatic identity on an administrator account, which is the thing the rule
 * exists to prevent.
 */
describe('an account that becomes an administrator', () => {
  const automatic = (subject: string) =>
    linkIdentity({
      ref: { kind: 'OIDC', issuer: ISSUER, subject },
      userId: ids.user,
      via: 'AUTO_VERIFIED_EMAIL',
      actorUserId: ids.user,
      context: CONTEXT,
    });

  it('keeps no automatically attached sign-in once promoted', async () => {
    await automatic('auto-before-promotion');
    await linkIdentity({
      ref: { kind: 'OIDC', issuer: `${ISSUER}/other`, subject: 'chosen' },
      userId: ids.user,
      via: 'SELF_SERVICE',
      actorUserId: ids.user,
      context: CONTEXT,
    });

    // What the promotion route does, in the same shape.
    await prisma.$transaction(
      async (tx) => {
        await tx.linkedIdentity.deleteMany({
          where: { userId: ids.user, linkedVia: { in: AUTOMATIC } },
        });
        await tx.user.update({ where: { id: ids.user }, data: { isAdmin: true } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const left = await prisma.linkedIdentity.findMany({
      where: { userId: ids.user },
      select: { linkedVia: true },
    });
    // The one they chose survives; the one nobody chose does not.
    expect(left.map((row) => row.linkedVia)).toEqual(['SELF_SERVICE']);
  });

  /**
   * The race itself, run for real. Whichever order the two land in, the invariant is the same:
   * an administrator account holds no automatically attached identity.
   */
  it('holds the rule when a promotion and an automatic link race', async () => {
    await Promise.all([
      automatic('auto-during-promotion').catch(() => null),
      prisma
        .$transaction(
          async (tx) => {
            await tx.linkedIdentity.deleteMany({
              where: { userId: ids.user, linkedVia: { in: AUTOMATIC } },
            });
            await tx.user.update({ where: { id: ids.user }, data: { isAdmin: true } });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
        .catch(() => null),
    ]);

    const promoted = await prisma.user.findUniqueOrThrow({
      where: { id: ids.user },
      select: { isAdmin: true },
    });
    const automaticLeft = await prisma.linkedIdentity.count({
      where: { userId: ids.user, linkedVia: { in: AUTOMATIC } },
    });

    if (promoted.isAdmin) expect(automaticLeft).toBe(0);
  });

  /** An ordinary account still links normally: the guard is about administrators. */
  it('still links an ordinary account', async () => {
    const result = await automatic('ordinary-account');

    expect(result).toEqual({ ok: true, created: true });
  });
});
