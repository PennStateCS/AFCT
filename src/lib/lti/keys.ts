/**
 * AFCT's own signing keypair, and the JWKS it publishes.
 *
 * LTI has two directions of trust, and they are easy to confuse. The platform signs the launch
 * token, and AFCT verifies it against the *platform's* keyset. Everything here is the other
 * direction: AFCT signs the token requests it makes for grade passback and roster sync, and the
 * platform verifies those against the keyset published from here.
 *
 * That second direction is why the JWKS endpoint has to be reachable **from the platform's
 * servers**, not just from a browser. Nothing in a launch touches it, so a setup that gets this
 * wrong looks completely healthy until the first grade fails to post.
 *
 * The private half is encrypted at rest like every other secret. Losing the encryption key is
 * worse here than anywhere else in AFCT: every platform is registered against a public key it
 * has already fetched, so a new keypair means re-registering AFCT with every LMS by hand.
 */

import { createPublicKey, generateKeyPairSync, createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { encryptSecret, decryptSecret } from '@/lib/secret-encryption';

/** RS256 is what LTI 1.3 specifies. Not a choice, and not somewhere to be inventive. */
export const LTI_SIGNING_ALG = 'RS256';

/** 2048 is the floor the spec allows and what every platform is tested against. */
const MODULUS_LENGTH = 2048;

/** One published key, as it appears in the JWKS. */
export type PublicJwk = {
  kty: 'RSA';
  use: 'sig';
  alg: typeof LTI_SIGNING_ALG;
  kid: string;
  n: string;
  e: string;
};

/**
 * The RFC 7638 thumbprint of the public key, used as its `kid`.
 *
 * Derived from the key rather than random so the same key always has the same name, which makes
 * a mismatch between what is published and what signed a token something you can actually see.
 */
function thumbprint(publicKeyPem: string): string {
  const jwk = createPublicKey(publicKeyPem).export({ format: 'jwk' }) as { n: string; e: string };
  // The member order here is fixed by the RFC: it is a hash of an exact string, not of an object.
  const canonical = JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n });
  return createHash('sha256').update(canonical).digest('base64url');
}

/** Turn a stored public key into its published form. */
function toJwk(kid: string, publicKeyPem: string): PublicJwk {
  const jwk = createPublicKey(publicKeyPem).export({ format: 'jwk' }) as { n: string; e: string };
  return { kty: 'RSA', use: 'sig', alg: LTI_SIGNING_ALG, kid, n: jwk.n, e: jwk.e };
}

/**
 * Create a keypair and publish it.
 *
 * `signingFrom` defaults to now, which is right for the first key: there is nothing else to sign
 * with, so waiting would mean signing with nothing. When rotating, set it far enough ahead that
 * platforms have refreshed their cached keyset, or the first token signed with it cannot be
 * verified by anyone.
 */
export async function createKeyPair(signingFrom = new Date()): Promise<{ kid: string }> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: MODULUS_LENGTH,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const kid = thumbprint(publicKey);

  await prisma.ltiKeyPair.create({
    data: { kid, publicKey, privateKey: encryptSecret(privateKey), signingFrom },
  });

  return { kid };
}

/**
 * Everything a platform should be able to verify against: every key that has not been retired.
 *
 * Includes keys whose `signingFrom` has not arrived yet, which is the whole point of publishing
 * ahead of time. Retired keys are excluded, which is what eventually makes a compromised key
 * stop being trusted.
 */
export async function listPublicJwks(): Promise<PublicJwk[]> {
  const keys = await prisma.ltiKeyPair.findMany({
    where: { retiredAt: null },
    select: { kid: true, publicKey: true },
    orderBy: { createdAt: 'desc' },
  });

  return keys.map((key) => toJwk(key.kid, key.publicKey));
}

/**
 * The key to sign with: the newest published key that is old enough to use.
 *
 * Derived rather than flagged, so there is no "exactly one is the signing key" invariant for two
 * concurrent rotations to break. Returns null when no key exists yet, which is a setup state
 * rather than an error: an install that never registers an LMS never needs one.
 */
export async function getSigningKey(
  now = new Date(),
): Promise<{ kid: string; privateKey: string } | null> {
  const key = await prisma.ltiKeyPair.findFirst({
    where: { retiredAt: null, signingFrom: { lte: now } },
    orderBy: { signingFrom: 'desc' },
    select: { kid: true, privateKey: true },
  });

  if (!key) return null;

  return { kid: key.kid, privateKey: decryptSecret(key.privateKey) };
}

/**
 * Stop publishing a key.
 *
 * Kept as a row rather than deleted, so a token that turns up later can still be traced to the
 * key that signed it. Retiring the only key leaves AFCT unable to sign anything, which is the
 * correct outcome when a key is compromised: better to fail than to keep using it.
 */
export async function retireKey(kid: string, now = new Date()): Promise<boolean> {
  const { count } = await prisma.ltiKeyPair.updateMany({
    where: { kid, retiredAt: null },
    data: { retiredAt: now },
  });
  return count === 1;
}

/**
 * The keypair AFCT signs with, creating one on first use.
 *
 * Generating on demand rather than at install time means an install that never touches LTI never
 * carries a key it does not need, and nothing has to remember to run a setup step.
 */
export async function ensureSigningKey(): Promise<{ kid: string; privateKey: string }> {
  const existing = await getSigningKey();
  if (existing) return existing;

  await createKeyPair();

  const created = await getSigningKey();
  // Only reachable if the row vanished between those two calls, which means something is
  // deleting keys underneath us. Failing loudly beats signing with a key nobody published.
  if (!created) throw new Error('LTI signing key could not be created.');
  return created;
}
