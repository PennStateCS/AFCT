import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';
import type { JsonWebKey as CryptoJwk } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { createKeyPair, listPublicJwks, getSigningKey, retireKey, ensureSigningKey } from './keys';

/**
 * AFCT's signing keypair, against a real Postgres.
 *
 * Two things are worth proving properly. That the private half really is encrypted at rest, so a
 * leaked database does not hand anyone the ability to sign as AFCT. And that the published
 * public half actually verifies a signature made by the stored private half, because a JWKS that
 * does not match the signing key fails only at the far end, inside an LMS, with an error nobody
 * here will see.
 */

async function destroyFixtures() {
  await prisma.ltiKeyPair.deleteMany({});
}

beforeEach(destroyFixtures);

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('creating a keypair', () => {
  it('stores the private half encrypted, never as a readable key', async () => {
    await createKeyPair();

    const row = await prisma.ltiKeyPair.findFirstOrThrow();
    expect(row.privateKey).not.toContain('PRIVATE KEY');
    expect(row.privateKey.startsWith('enc.v1:')).toBe(true);
  });

  it('leaves the public half readable, because publishing it is the point', async () => {
    await createKeyPair();

    const row = await prisma.ltiKeyPair.findFirstOrThrow();
    expect(row.publicKey).toContain('PUBLIC KEY');
  });

  // The kid is a thumbprint of the key, not a random string, so the same key is always named
  // the same thing and a published/signing mismatch is visible rather than mysterious.
  it('names the key after its own contents', async () => {
    const { kid } = await createKeyPair();
    const row = await prisma.ltiKeyPair.findFirstOrThrow();

    const [jwk] = await listPublicJwks();
    expect(jwk.kid).toBe(kid);
    expect(row.kid).toBe(kid);
  });

  it('gives two keypairs different names', async () => {
    const first = await createKeyPair();
    const second = await createKeyPair();

    expect(first.kid).not.toBe(second.kid);
  });
});

/**
 * The check that a JWKS mismatch cannot hide behind. Everything else could pass while the
 * published key and the signing key are unrelated, and the only symptom would be inside an LMS.
 */
describe('the published key and the signing key', () => {
  it('are two halves of one keypair', async () => {
    await createKeyPair();
    const signing = await getSigningKey();
    const [jwk] = await listPublicJwks();

    const message = Buffer.from('a token AFCT signed');
    const signature = createSign('RSA-SHA256')
      .update(message)
      .sign(createPrivateKey(signing!.privateKey));

    // Rebuilt from the *published* JWK, which is what a platform actually verifies against.
    const published = createPublicKey({ key: jwk as unknown as CryptoJwk, format: 'jwk' });
    expect(createVerify('RSA-SHA256').update(message).verify(published, signature)).toBe(true);
  });

  it('publishes it as an RS256 signing key, which is what LTI requires', async () => {
    await createKeyPair();

    const [jwk] = await listPublicJwks();
    expect(jwk).toMatchObject({ kty: 'RSA', use: 'sig', alg: 'RS256' });
  });

  /**
   * An RSA JWK carries the private key in `d` and the primes in `p`/`q`, and exporting a private
   * key to JWK includes them all. Publishing one would hand out the ability to sign as AFCT, so
   * this asserts the published document carries only the public members.
   */
  it('publishes no private material', async () => {
    await createKeyPair();

    const [jwk] = await listPublicJwks();
    expect(Object.keys(jwk).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
  });
});

describe('choosing which key signs', () => {
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60_000);

  it('uses the newest key that is old enough', async () => {
    await createKeyPair(new Date(Date.now() - 120_000));
    const newer = await createKeyPair(past);

    expect((await getSigningKey())?.kid).toBe(newer.kid);
  });

  /**
   * The reason a key can be published before it is used. A platform that has not refreshed its
   * cached keyset cannot verify a token signed by a key it has never seen.
   */
  it('will not sign with a key published for later', async () => {
    const current = await createKeyPair(past);
    await createKeyPair(future);

    expect((await getSigningKey())?.kid).toBe(current.kid);
  });

  it('publishes that later key anyway, so platforms can pick it up first', async () => {
    const current = await createKeyPair(past);
    const upcoming = await createKeyPair(future);

    const kids = (await listPublicJwks()).map((k) => k.kid);
    expect(kids).toContain(upcoming.kid);
    expect(kids).toContain(current.kid);
  });

  it('has nothing to sign with before any key exists', async () => {
    expect(await getSigningKey()).toBeNull();
  });
});

describe('retiring a key', () => {
  it('stops publishing it', async () => {
    const { kid } = await createKeyPair();

    expect(await retireKey(kid)).toBe(true);
    expect(await listPublicJwks()).toEqual([]);
  });

  it('stops signing with it', async () => {
    const { kid } = await createKeyPair();
    await retireKey(kid);

    expect(await getSigningKey()).toBeNull();
  });

  // Kept rather than deleted, so a token that turns up later can still be traced to its key.
  it('keeps the row', async () => {
    const { kid } = await createKeyPair();
    await retireKey(kid);

    expect(await prisma.ltiKeyPair.count()).toBe(1);
  });

  it('reports an unknown or already-retired key rather than pretending', async () => {
    const { kid } = await createKeyPair();
    await retireKey(kid);

    expect(await retireKey(kid)).toBe(false);
    expect(await retireKey('never-existed')).toBe(false);
  });
});

describe('first use', () => {
  it('creates a key when there is none', async () => {
    const key = await ensureSigningKey();

    expect(key.privateKey).toContain('PRIVATE KEY');
    expect(await prisma.ltiKeyPair.count()).toBe(1);
  });

  it('reuses the existing one rather than making a second', async () => {
    const first = await ensureSigningKey();
    const second = await ensureSigningKey();

    expect(second.kid).toBe(first.kid);
    expect(await prisma.ltiKeyPair.count()).toBe(1);
  });
});
