/**
 * The seed's source of randomness, made reproducible.
 *
 * A development database used to differ between machines: rosters, points, submission limits and
 * autograder flags were all drawn from `Math.random()` or the CSPRNG, so "reproduce it locally"
 * meant "hope your data resembles mine". For sample data there is nothing to gain from real
 * entropy and something real to lose, so this is a small deterministic generator instead.
 *
 * Set `AFCT_SEED` to any number for a different but equally reproducible database. Nothing here
 * is used outside the seed; anything that matters, like a password reset token, must keep using
 * `node:crypto`.
 */

/** mulberry32: tiny, fast, and good enough for choosing which student gets which problem. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED_VALUE = Number(process.env.AFCT_SEED ?? 20260816);

/** A float in [0, 1). */
export const seedRandom = mulberry32(SEED_VALUE);

/** An integer in [0, max), or in [min, max) with two arguments. Mirrors `crypto.randomInt`. */
export function seedRandomInt(minOrMax: number, max?: number): number {
  const min = max === undefined ? 0 : minOrMax;
  const bound = max === undefined ? minOrMax : max;
  if (bound <= min) return min;
  return min + Math.floor(seedRandom() * (bound - min));
}
