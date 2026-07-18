-- Sticky lock timestamp for group sets: stamped when the first submission or grade is
-- created for an assignment using the set, never cleared.

-- AlterTable
ALTER TABLE "GroupSet" ADD COLUMN     "lockedAt" TIMESTAMP(3);
