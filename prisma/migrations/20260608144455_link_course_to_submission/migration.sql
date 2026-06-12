/*
  Warnings:

  - Added the required column `courseId` to the `Submission` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."Submission_studentId_assignmentId_problemId_submittedAt_idx";

-- AlterTable
ALTER TABLE "public"."Submission" ADD COLUMN     "courseId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Submission_courseId_idx" ON "public"."Submission"("courseId");

-- CreateIndex
CREATE INDEX "Submission_studentId_courseId_assignmentId_problemId_submit_idx" ON "public"."Submission"("studentId", "courseId", "assignmentId", "problemId", "submittedAt");

-- AddForeignKey
ALTER TABLE "public"."Submission" ADD CONSTRAINT "Submission_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "public"."Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
