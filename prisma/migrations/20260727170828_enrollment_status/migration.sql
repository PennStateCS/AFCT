-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'DROPPED');

-- AlterTable
ALTER TABLE "Roster" ADD COLUMN     "droppedAt" TIMESTAMP(3),
ADD COLUMN     "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED';

-- CreateIndex
CREATE INDEX "Roster_courseId_role_status_idx" ON "Roster"("courseId", "role", "status");
