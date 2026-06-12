-- AlterTable
ALTER TABLE "public"."Submission" ALTER COLUMN "gradedAt" DROP NOT NULL,
ALTER COLUMN "gradedAt" DROP DEFAULT;
