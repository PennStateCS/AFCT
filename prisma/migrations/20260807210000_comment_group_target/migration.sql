-- A comment can be addressed to a whole group, so staff reviewing a group's shared
-- submission write one comment every member sees instead of a copy per member.

ALTER TABLE "Comment" ADD COLUMN "aboutGroupId" TEXT;

-- SetNull, not Cascade: deleting a group must not destroy the feedback written about its
-- work. The comment survives and stops being addressed to anyone, which is recoverable.
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_aboutGroupId_fkey"
  FOREIGN KEY ("aboutGroupId") REFERENCES "StudentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one target. A comment addressed to both a student and a group has no coherent
-- audience, and the read path would return it twice.
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_target_not_both"
  CHECK (NOT ("aboutStudentId" IS NOT NULL AND "aboutGroupId" IS NOT NULL));

CREATE INDEX "Comment_aboutGroupId_idx" ON "Comment"("aboutGroupId");
CREATE INDEX "Comment_assignmentId_problemId_aboutGroupId_idx"
  ON "Comment"("assignmentId", "problemId", "aboutGroupId");
