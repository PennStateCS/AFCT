-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "isSuspicious" BOOLEAN,
ADD COLUMN     "isSuspiciousOverride" BOOLEAN,
ADD COLUMN     "isSuspiciousReason" TEXT;
