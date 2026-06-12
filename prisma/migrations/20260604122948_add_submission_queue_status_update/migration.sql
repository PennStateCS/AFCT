/*
  Warnings:

  - You are about to drop the column `queuedAt` on the `Submission` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Submission" DROP COLUMN "queuedAt",
ADD COLUMN     "gradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
