-- AlterTable
ALTER TABLE "public"."Submission" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Submission_status_submittedAt_idx" ON "public"."Submission"("status", "submittedAt");
