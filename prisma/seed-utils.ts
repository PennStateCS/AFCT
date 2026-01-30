import { PrismaClient } from '@prisma/client';

export const withRole = <T, R>(items: T[], role: R) =>
  items.map((item) => ({ ...item, role }));

export const pickRandom = <T,>(items: T[]): T | undefined => {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
};

export const pickRandomRange = <T,>(items: T[], min: number, max: number): T[] => {
  const count = Math.min(
    items.length,
    Math.max(min, Math.floor(Math.random() * (max - min + 1)) + min),
  );
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

export const upsertRoster = async (
  prisma: PrismaClient,
  courseId: string,
  userId: string,
  role: 'INSTRUCTOR' | 'TA' | 'STUDENT',
) => {
  await prisma.roster.upsert({
    where: {
      courseId_userId: {
        courseId,
        userId,
      },
    },
    update: { role },
    create: {
      role,
      courseId,
      userId,
    },
  });
};

export type Term = 'Spring' | 'Summer' | 'Fall';

export const getTermSequence = (currentTerm: Term, currentYear: number) => {
  if (currentTerm === 'Spring') {
    return [
      { term: 'Spring' as Term, year: currentYear },
      { term: 'Summer' as Term, year: currentYear },
      { term: 'Fall' as Term, year: currentYear },
    ];
  }

  if (currentTerm === 'Summer') {
    return [
      { term: 'Summer' as Term, year: currentYear },
      { term: 'Fall' as Term, year: currentYear },
      { term: 'Spring' as Term, year: currentYear + 1 },
    ];
  }

  return [
    { term: 'Fall' as Term, year: currentYear },
    { term: 'Spring' as Term, year: currentYear + 1 },
    { term: 'Summer' as Term, year: currentYear + 1 },
  ];
};
