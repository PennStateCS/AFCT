-- DropIndex
DROP INDEX "ActivityLog_category_idx";

-- DropIndex
DROP INDEX "ActivityLog_timestamp_category_idx";

-- DropIndex
DROP INDEX "Assignment_courseId_idx";

-- DropIndex
DROP INDEX "AssignmentProblem_assignmentId_idx";

-- DropIndex
DROP INDEX "AssignmentProblemGrade_assignmentId_idx";

-- DropIndex
DROP INDEX "AssignmentProblemGrade_assignmentId_problemId_idx";

-- DropIndex
DROP INDEX "AssignmentProblemGrade_studentId_idx";

-- DropIndex
DROP INDEX "Comment_assignmentId_idx";

-- DropIndex
DROP INDEX "Comment_assignmentId_problemId_idx";

-- DropIndex
DROP INDEX "GroupSet_courseId_idx";

-- DropIndex
DROP INDEX "Roster_courseId_idx";

-- DropIndex
DROP INDEX "StudentGroup_groupSetId_idx";

-- DropIndex
DROP INDEX "Submission_assignmentId_idx";

-- DropIndex
DROP INDEX "Submission_assignmentId_problemId_idx";

-- DropIndex
DROP INDEX "Submission_courseId_idx";

-- DropIndex
DROP INDEX "Submission_status_idx";

-- DropIndex
DROP INDEX "Submission_studentId_idx";

-- CreateIndex
CREATE INDEX "ActivityLog_category_timestamp_idx" ON "ActivityLog"("category", "timestamp");

-- CreateIndex
CREATE INDEX "AssignmentOverride_createdById_idx" ON "AssignmentOverride"("createdById");

-- CreateIndex
CREATE INDEX "AssignmentProblem_problemId_idx" ON "AssignmentProblem"("problemId");

-- CreateIndex
CREATE INDEX "LtiContextLink_linkedByUserId_idx" ON "LtiContextLink"("linkedByUserId");

-- CreateIndex
CREATE INDEX "LtiDeepLink_createdByUserId_idx" ON "LtiDeepLink"("createdByUserId");

-- CreateIndex
CREATE INDEX "LtiPendingDeepLink_platformId_idx" ON "LtiPendingDeepLink"("platformId");

-- CreateIndex
CREATE INDEX "LtiPendingIdentityLink_userId_idx" ON "LtiPendingIdentityLink"("userId");

-- CreateIndex
CREATE INDEX "LtiPendingLink_platformId_idx" ON "LtiPendingLink"("platformId");

-- CreateIndex
CREATE INDEX "LtiScoreQueue_userId_idx" ON "LtiScoreQueue"("userId");

-- CreateIndex
CREATE INDEX "SubmissionGrant_createdById_idx" ON "SubmissionGrant"("createdById");
