-- Who produced a problem grade, as opposed to whether it is held against automatic grading.
-- The two were one field, and they come apart the moment staff release a grade they entered
-- by hand or hold one the autograder wrote.
CREATE TYPE "GradeSource" AS ENUM ('AUTOGRADER', 'MANUAL');

ALTER TABLE "AssignmentProblemGrade"
  ADD COLUMN "gradeSource" "GradeSource" NOT NULL DEFAULT 'AUTOGRADER';

-- Backfill from the hold flag, which is the only signal existing rows carry. It is right for
-- every row written so far: until this release the flag was set by the three hand-grading
-- paths and cleared by nothing except the worker, so held meant hand-entered. Rows released
-- through the old switch would be misread as autograded, which is the same thing the UI was
-- already telling people and cannot be recovered from the data either way.
UPDATE "AssignmentProblemGrade" SET "gradeSource" = 'MANUAL' WHERE "gradedManually" = true;
