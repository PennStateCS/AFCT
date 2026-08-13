-- Messages waiting to go out, so the password-reset endpoint answers without holding an SMTP
-- conversation open. The body is encrypted because a reset link is a working key to an account.

CREATE TYPE "MailState" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "MailQueue" (
  "id" TEXT NOT NULL,
  "toAddress" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "bodyEncrypted" TEXT NOT NULL,
  "tokenHash" TEXT,
  "state" "MailState" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MailQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MailQueue_state_nextAttemptAt_idx" ON "MailQueue"("state", "nextAttemptAt");
