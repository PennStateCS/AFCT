-- CreateEnum
CREATE TYPE "WorkerSource" AS ENUM ('WORKER_CONTAINER', 'APP_PROCESS');

-- CreateTable
CREATE TABLE "WorkerSlot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "source" "WorkerSource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "submissionId" TEXT,
    "busySince" TIMESTAMP(3),

    CONSTRAINT "WorkerSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerSlot_runId_slot_key" ON "WorkerSlot"("runId", "slot");
