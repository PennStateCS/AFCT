-- Split an assignment's audience (WHO is assigned) from its date/late overrides (WHEN).
-- Membership moves to AssignmentAssignee; AssignmentOverride becomes strictly date/late
-- exceptions again. Individual-vs-group is now solely Assignment.groupSetId, so the
-- redundant isGroup flag is dropped. Dev-only: no production data to preserve.

-- 1. Audience membership table. Mirrors the override table's target shape (STUDENT|GROUP,
--    XOR-constrained) but carries no dates.
CREATE TABLE "AssignmentAssignee" (
  "id" TEXT NOT NULL,
  "targetType" "OverrideTargetType" NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "userId" TEXT,
  "groupId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentAssignee_pkey" PRIMARY KEY ("id")
);

-- Exactly one target, consistent with the discriminator.
ALTER TABLE "AssignmentAssignee" ADD CONSTRAINT "AssignmentAssignee_target_xor"
  CHECK (
    ("targetType" = 'STUDENT' AND "userId" IS NOT NULL AND "groupId" IS NULL) OR
    ("targetType" = 'GROUP'   AND "groupId" IS NOT NULL AND "userId" IS NULL)
  );

-- NULLS DISTINCT (Postgres default) keeps STUDENT rows (groupId null) and GROUP rows
-- (userId null) from colliding on these unique indexes.
CREATE UNIQUE INDEX "AssignmentAssignee_assignmentId_userId_key" ON "AssignmentAssignee"("assignmentId", "userId");
CREATE UNIQUE INDEX "AssignmentAssignee_assignmentId_groupId_key" ON "AssignmentAssignee"("assignmentId", "groupId");
CREATE INDEX "AssignmentAssignee_userId_idx" ON "AssignmentAssignee"("userId");
CREATE INDEX "AssignmentAssignee_groupId_idx" ON "AssignmentAssignee"("groupId");

ALTER TABLE "AssignmentAssignee" ADD CONSTRAINT "AssignmentAssignee_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentAssignee" ADD CONSTRAINT "AssignmentAssignee_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentAssignee" ADD CONSTRAINT "AssignmentAssignee_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "StudentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Existing dateless override rows were serving purely as assignee markers ("assign to
--    specific students/groups", inheriting the base dates). Move them into the new table,
--    then remove them from AssignmentOverride.
INSERT INTO "AssignmentAssignee" ("id", "targetType", "assignmentId", "userId", "groupId", "createdAt", "updatedAt")
SELECT "id", "targetType", "assignmentId", "userId", "groupId", "createdAt", "updatedAt"
FROM "AssignmentOverride"
WHERE "unlockAt" IS NULL AND "dueDate" IS NULL AND "lateCutoff" IS NULL AND "allowLateSubmissions" IS NULL;

DELETE FROM "AssignmentOverride"
WHERE "unlockAt" IS NULL AND "dueDate" IS NULL AND "lateCutoff" IS NULL AND "allowLateSubmissions" IS NULL;

-- 3. An override must change at least one field again, now that membership lives elsewhere.
ALTER TABLE "AssignmentOverride" ADD CONSTRAINT "AssignmentOverride_has_change"
  CHECK ("unlockAt" IS NOT NULL OR "dueDate" IS NOT NULL OR "lateCutoff" IS NOT NULL OR "allowLateSubmissions" IS NOT NULL);

-- 4. Drop the redundant Individual/Group flag: group-ness is exactly (groupSetId IS NOT NULL).
ALTER TABLE "Assignment" DROP COLUMN "isGroup";
