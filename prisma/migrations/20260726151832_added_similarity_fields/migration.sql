-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "fileHash" TEXT,
ADD COLUMN     "similarityReportJson" JSONB;
