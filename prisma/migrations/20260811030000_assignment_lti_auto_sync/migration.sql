
-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "ltiAutoSync" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "LtiScoreQueue" ADD CONSTRAINT "LtiScoreQueue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

