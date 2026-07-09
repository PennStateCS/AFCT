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
