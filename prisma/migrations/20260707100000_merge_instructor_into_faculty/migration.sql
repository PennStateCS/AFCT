-- Merge the INSTRUCTOR course role into FACULTY, then drop the INSTRUCTOR enum value.
-- CourseRole is only used by "Roster"."role" (no default to re-apply).

UPDATE "Roster" SET "role" = 'FACULTY' WHERE "role" = 'INSTRUCTOR';

ALTER TYPE "CourseRole" RENAME TO "CourseRole_old";
CREATE TYPE "CourseRole" AS ENUM ('FACULTY', 'TA', 'STUDENT');
ALTER TABLE "Roster" ALTER COLUMN "role" TYPE "CourseRole" USING ("role"::text::"CourseRole");
DROP TYPE "CourseRole_old";
