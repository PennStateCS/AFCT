/*
  Warnings:

  - You are about to drop the column `contentHash` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `fileHash` on the `Submission` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Submission" DROP COLUMN "contentHash",
DROP COLUMN "fileHash",
ADD COLUMN     "calcHashData" TEXT,
ADD COLUMN     "fileHashData" TEXT;
