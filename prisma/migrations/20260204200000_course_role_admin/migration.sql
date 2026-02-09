-- Update CourseRole enum: replace INSTRUCTOR with ADMIN

ALTER TYPE "CourseRole" RENAME TO "CourseRole_old";

CREATE TYPE "CourseRole" AS ENUM ('ADMIN', 'FACULTY', 'TA', 'STUDENT');

ALTER TABLE "Roster"
  ALTER COLUMN "role" TYPE "CourseRole"
  USING (
    CASE
      WHEN "role"::text = 'INSTRUCTOR' THEN 'ADMIN'
      ELSE "role"::text
    END
  )::"CourseRole";

DROP TYPE "CourseRole_old";
