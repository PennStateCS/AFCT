-- Per-target due-date overrides (Canvas "Assign To"). Only STUDENT overrides ship now;
-- GROUP is reserved for the Group Sets rework.
CREATE TYPE "OverrideTargetType" AS ENUM ('STUDENT', 'GROUP');

-- "Available from" for the whole class (null = available immediately).
ALTER TABLE "Assignment" ADD COLUMN "unlockAt" TIMESTAMP(3);

CREATE TABLE "AssignmentOverride" (
  "id" TEXT NOT NULL,
  "targetType" "OverrideTargetType" NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "userId" TEXT,
  "groupId" TEXT,
  "unlockAt" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "lateCutoff" TIMESTAMP(3),
  "allowLateSubmissions" BOOLEAN,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentOverride_pkey" PRIMARY KEY ("id")
);

-- Exactly one target, consistent with the discriminator.
ALTER TABLE "AssignmentOverride" ADD CONSTRAINT "AssignmentOverride_target_xor"
  CHECK (
    ("targetType" = 'STUDENT' AND "userId" IS NOT NULL AND "groupId" IS NULL) OR
    ("targetType" = 'GROUP'   AND "groupId" IS NOT NULL AND "userId" IS NULL)
  );

-- An override that changes nothing is meaningless.
ALTER TABLE "AssignmentOverride" ADD CONSTRAINT "AssignmentOverride_has_change"
  CHECK ("unlockAt" IS NOT NULL OR "dueDate" IS NOT NULL OR "lateCutoff" IS NOT NULL OR "allowLateSubmissions" IS NOT NULL);

-- NULLS DISTINCT (Postgres default) keeps STUDENT rows (groupId null) and future GROUP
-- rows (userId null) from colliding on these unique indexes.
CREATE UNIQUE INDEX "AssignmentOverride_assignmentId_userId_key" ON "AssignmentOverride"("assignmentId", "userId");
CREATE UNIQUE INDEX "AssignmentOverride_assignmentId_groupId_key" ON "AssignmentOverride"("assignmentId", "groupId");
CREATE INDEX "AssignmentOverride_userId_idx" ON "AssignmentOverride"("userId");
CREATE INDEX "AssignmentOverride_groupId_idx" ON "AssignmentOverride"("groupId");

ALTER TABLE "AssignmentOverride" ADD CONSTRAINT "AssignmentOverride_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentOverride" ADD CONSTRAINT "AssignmentOverride_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentOverride" ADD CONSTRAINT "AssignmentOverride_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- NOTE: groupId has no foreign key yet. The Group Sets rework must add the FK to the new
-- group table and backfill/validate referential integrity when it wires group targeting.
