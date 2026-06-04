-- CreateEnum
CREATE TYPE "public"."SubmissionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "public"."Submission" ADD COLUMN     "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "public"."SubmissionStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "public"."Submission"("status");
