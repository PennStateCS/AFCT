-- Remove the legacy flat Group system (Group / GroupRoster / GroupAssignmentProblem,
-- Assignment.isGroup, Submission.groupId). Group assignments now run on group sets:
-- Assignment.groupSetId ties an assignment to one set, GROUP AssignmentOverride rows
-- point at StudentGroups, and Submission.studentGroupId owns a group submission set.
-- Dev-only: no production data to preserve (all Submission.groupId were null).

-- DropForeignKey
ALTER TABLE "Group" DROP CONSTRAINT "Group_courseId_fkey";

-- DropForeignKey
ALTER TABLE "GroupRoster" DROP CONSTRAINT "GroupRoster_courseId_fkey";

-- DropForeignKey
ALTER TABLE "GroupRoster" DROP CONSTRAINT "GroupRoster_userId_fkey";

-- DropForeignKey
ALTER TABLE "GroupRoster" DROP CONSTRAINT "GroupRoster_groupId_fkey";

-- DropForeignKey
ALTER TABLE "GroupAssignmentProblem" DROP CONSTRAINT "GroupAssignmentProblem_assignmentId_fkey";

-- DropForeignKey
ALTER TABLE "GroupAssignmentProblem" DROP CONSTRAINT "GroupAssignmentProblem_problemId_fkey";

-- DropForeignKey
ALTER TABLE "GroupAssignmentProblem" DROP CONSTRAINT "GroupAssignmentProblem_groupId_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_groupId_fkey";

-- DropIndex
DROP INDEX "Assignment_isGroup_idx";

-- DropIndex
DROP INDEX "Submission_groupId_idx";

-- DropIndex
DROP INDEX "Submission_assignmentId_problemId_groupId_key";

-- AlterTable
ALTER TABLE "Assignment" DROP COLUMN "isGroup",
ADD COLUMN     "groupSetId" TEXT;

-- AlterTable
ALTER TABLE "Submission" DROP COLUMN "groupId",
ADD COLUMN     "studentGroupId" TEXT;

-- DropTable
DROP TABLE "Group";

-- DropTable
DROP TABLE "GroupRoster";

-- DropTable
DROP TABLE "GroupAssignmentProblem";

-- CreateIndex
CREATE INDEX "Assignment_groupSetId_idx" ON "Assignment"("groupSetId");

-- CreateIndex
CREATE INDEX "Submission_studentGroupId_idx" ON "Submission"("studentGroupId");

-- CreateIndex
CREATE INDEX "Submission_assignmentId_problemId_studentGroupId_idx" ON "Submission"("assignmentId", "problemId", "studentGroupId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_groupSetId_fkey" FOREIGN KEY ("groupSetId") REFERENCES "GroupSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentOverride" ADD CONSTRAINT "AssignmentOverride_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_studentGroupId_fkey" FOREIGN KEY ("studentGroupId") REFERENCES "StudentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
