import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Generates a unique course registration code in the format `ABC123` (three letters
 * followed by three digits), retrying until it finds one not already taken. Shared by
 * course creation (`POST /api/courses`) and duplication (`POST /api/courses/[id]/duplicate`)
 * so both mint codes the same way.
 */
export async function generateUniqueCourseCode(): Promise<string> {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';

  function randomCode() {
    const part1 = Array.from(
      { length: 3 },
      () => letters[Math.floor(Math.random() * letters.length)],
    ).join('');
    const part2 = Array.from(
      { length: 3 },
      () => numbers[Math.floor(Math.random() * numbers.length)],
    ).join('');
    return `${part1}${part2}`.toUpperCase();
  }

  let code: string;
  let exists = true;

  do {
    code = randomCode();
    const existing = await prisma.course.findUnique({ where: { regCode: code } });
    exists = !!existing;
  } while (exists);

  return code;
}

/** True when `err` is a unique-constraint (P2002) violation on `Course.regCode`. */
export function isRegCodeConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    return false;
  }
  const target = err.meta?.target;
  return Array.isArray(target)
    ? target.includes('regCode')
    : typeof target === 'string' && target.includes('regCode');
}

/**
 * Allocates a unique registration code and runs `create` with it. The uniqueness
 * check in {@link generateUniqueCourseCode} happens before the insert, so a
 * concurrent course creation can claim the same code in between and the insert then
 * fails with a P2002 on `regCode`. This retries such conflicts with a fresh code (up
 * to `attempts` times). `create` performs the actual insert — often a whole
 * transaction, which Postgres aborts on the conflict, so it is safely re-run. Any
 * other error propagates immediately.
 */
export async function createWithUniqueCourseCode<T>(
  create: (regCode: string) => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const regCode = await generateUniqueCourseCode();
    try {
      return await create(regCode);
    } catch (err) {
      if (attempt < attempts && isRegCodeConflict(err)) continue;
      throw err;
    }
  }
  // The loop always returns or throws; this only satisfies the return type.
  throw new Error('Could not allocate a unique course registration code');
}
