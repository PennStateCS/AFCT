-- Grading a group writes one row per member, so every existing reader keeps finding a grade
-- on each student. These two columns only record where a row came from, so a later change to
-- one member reads as a deliberate adjustment rather than an inconsistency.

ALTER TABLE "AssignmentProblemGrade" ADD COLUMN "groupGradeGroupId" TEXT;
ALTER TABLE "AssignmentProblemGrade" ADD COLUMN "groupGradeValue" DOUBLE PRECISION;

-- SetNull: deleting a group must not delete anybody's grade. The row loses its provenance
-- and becomes an ordinary individual grade, which is recoverable; a cascade is not.
ALTER TABLE "AssignmentProblemGrade" ADD CONSTRAINT "AssignmentProblemGrade_groupGradeGroupId_fkey"
  FOREIGN KEY ("groupGradeGroupId") REFERENCES "StudentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A group id is meaningless without the value it applied, so that direction is required.
-- The reverse is not: deleting a group nulls the id via SET NULL above and deliberately
-- leaves the value behind, which keeps "this grade was adjusted away from 8" true after the
-- group is gone. Requiring both would make deleting a graded group fail outright.
ALTER TABLE "AssignmentProblemGrade" ADD CONSTRAINT "AssignmentProblemGrade_group_provenance"
  CHECK (NOT ("groupGradeGroupId" IS NOT NULL AND "groupGradeValue" IS NULL));

CREATE INDEX "AssignmentProblemGrade_groupGradeGroupId_idx"
  ON "AssignmentProblemGrade"("groupGradeGroupId");
