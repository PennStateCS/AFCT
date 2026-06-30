-- AlterTable
ALTER TABLE "public"."SystemSettings"
  ADD COLUMN     "submissionEvalTimeoutMs" INTEGER NOT NULL DEFAULT 30000,
  ADD COLUMN     "submissionEvalMaxMemoryMb" INTEGER NOT NULL DEFAULT 256,
  ADD COLUMN     "submissionResubmitCooldownMs" INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN     "submissionMaxConcurrent" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN     "submissionMaxAttempts" INTEGER NOT NULL DEFAULT 3;
