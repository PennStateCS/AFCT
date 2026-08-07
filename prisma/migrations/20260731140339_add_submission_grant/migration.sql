-- CreateTable
CREATE TABLE "SubmissionGrant" (
    "id" TEXT NOT NULL,
    "targetType" "OverrideTargetType" NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "extraSubmissions" INTEGER NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionGrant_userId_idx" ON "SubmissionGrant"("userId");

-- CreateIndex
CREATE INDEX "SubmissionGrant_groupId_idx" ON "SubmissionGrant"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionGrant_assignmentId_problemId_userId_key" ON "SubmissionGrant"("assignmentId", "problemId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionGrant_assignmentId_problemId_groupId_key" ON "SubmissionGrant"("assignmentId", "problemId", "groupId");

-- AddForeignKey
ALTER TABLE "SubmissionGrant" ADD CONSTRAINT "SubmissionGrant_assignmentId_problemId_fkey" FOREIGN KEY ("assignmentId", "problemId") REFERENCES "AssignmentProblem"("assignmentId", "problemId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionGrant" ADD CONSTRAINT "SubmissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionGrant" ADD CONSTRAINT "SubmissionGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionGrant" ADD CONSTRAINT "SubmissionGrant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one target, consistent with the discriminator (same shape as AssignmentOverride).
ALTER TABLE "SubmissionGrant" ADD CONSTRAINT "SubmissionGrant_target_xor"
  CHECK (
    ("targetType" = 'STUDENT' AND "userId" IS NOT NULL AND "groupId" IS NULL) OR
    ("targetType" = 'GROUP'   AND "groupId" IS NOT NULL AND "userId" IS NULL)
  );

-- A grant always ADDS submissions; zero or negative rows are meaningless and would let a
-- buggy caller silently shrink a student's cap.
ALTER TABLE "SubmissionGrant" ADD CONSTRAINT "SubmissionGrant_positive"
  CHECK ("extraSubmissions" > 0);
