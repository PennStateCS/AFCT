import type { CourseRole } from '@prisma/client';

/**
 * The per-course roles, in the order they are offered in pickers.
 *
 * This lives in its own module, with no zod and no runtime `@prisma/client` import, because of
 * where it gets used. `lib/roles.ts` provides the roster tables' role column and sorting, so it
 * is reachable from every page that lists people: the course page, the users page, and anything
 * embedding a roster. It used to take this list from `CourseRoleEnum.options` in
 * `@/schemas/user`, which meant importing a schema module, which meant the whole zod runtime
 * landed in those bundles for the sake of three strings.
 *
 * `schemas/user.ts` builds its zod enum from this array, so there is still one source of truth
 * and the dependency points the harmless way: the schema knows about the list, not the reverse.
 *
 * Keep in sync with the Prisma `CourseRole` enum.
 */
export const COURSE_ROLE_VALUES = ['FACULTY', 'TA', 'STUDENT'] as const;

/** The same values typed as Prisma's `CourseRole`, which is what call sites want. */
export const courseRoleOptions: CourseRole[] = [...COURSE_ROLE_VALUES];
