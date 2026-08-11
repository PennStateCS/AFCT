
-- CreateEnum
CREATE TYPE "LtiScoreState" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "LtiScoreQueue" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scoreGiven" DOUBLE PRECISION NOT NULL,
    "scoreMaximum" DOUBLE PRECISION NOT NULL,
    "state" "LtiScoreState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LtiScoreQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LtiScoreQueue_state_nextAttemptAt_idx" ON "LtiScoreQueue"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "LtiScoreQueue_assignmentId_userId_key" ON "LtiScoreQueue"("assignmentId", "userId");

-- AddForeignKey
ALTER TABLE "LtiLineItem" ADD CONSTRAINT "LtiLineItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiScoreQueue" ADD CONSTRAINT "LtiScoreQueue_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
