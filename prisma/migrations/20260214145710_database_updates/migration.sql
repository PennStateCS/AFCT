-- AlterTable
ALTER TABLE "public"."Assignment" ADD COLUMN     "allowLateSubmissions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lateCutoff" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."AssignmentProblem" ADD COLUMN     "autograderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "maxSubmissions" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "public"."Course" ADD COLUMN     "registrationCloseAt" TIMESTAMP(3),
ADD COLUMN     "registrationOpenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Assignment_lateCutoff_idx" ON "public"."Assignment"("lateCutoff");

-- CreateIndex
CREATE INDEX "AssignmentProblem_assignmentId_idx" ON "public"."AssignmentProblem"("assignmentId");

-- CreateIndex
CREATE INDEX "Course_registrationOpenAt_idx" ON "public"."Course"("registrationOpenAt");

-- CreateIndex
CREATE INDEX "Course_registrationCloseAt_idx" ON "public"."Course"("registrationCloseAt");

-- CreateIndex
CREATE INDEX "Submission_assignmentId_problemId_idx" ON "public"."Submission"("assignmentId", "problemId");

-- CreateIndex
CREATE INDEX "Submission_studentId_assignmentId_problemId_submittedAt_idx" ON "public"."Submission"("studentId", "assignmentId", "problemId", "submittedAt");
