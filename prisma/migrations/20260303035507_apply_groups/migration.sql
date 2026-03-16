/*
  Warnings:

  - The values [ADMIN] on the enum `CourseRole` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[assignmentId,problemId,groupId]` on the table `Submission` will be added. If there are existing duplicate values, this will fail.
  - Made the column `grade` on table `AssignmentProblemGrade` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."CourseRole_new" AS ENUM ('INSTRUCTOR', 'FACULTY', 'TA', 'STUDENT');
ALTER TABLE "public"."Roster" ALTER COLUMN "role" TYPE "public"."CourseRole_new" USING ("role"::text::"public"."CourseRole_new");
ALTER TYPE "public"."CourseRole" RENAME TO "CourseRole_old";
ALTER TYPE "public"."CourseRole_new" RENAME TO "CourseRole";
DROP TYPE "public"."CourseRole_old";
COMMIT;

-- AlterTable
ALTER TABLE "public"."Assignment" ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."AssignmentProblemGrade" ALTER COLUMN "grade" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."Submission" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "public"."Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GroupRoster" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GroupAssignmentProblem" (
    "assignmentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "GroupAssignmentProblem_pkey" PRIMARY KEY ("assignmentId","problemId","groupId")
);

-- CreateTable
CREATE TABLE "public"."AssignmentGrade" (
    "id" TEXT NOT NULL,
    "grade" DOUBLE PRECISION NOT NULL,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "AssignmentGrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Group_courseId_idx" ON "public"."Group"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_courseId_name_key" ON "public"."Group"("courseId", "name");

-- CreateIndex
CREATE INDEX "GroupRoster_courseId_idx" ON "public"."GroupRoster"("courseId");

-- CreateIndex
CREATE INDEX "GroupRoster_userId_idx" ON "public"."GroupRoster"("userId");

-- CreateIndex
CREATE INDEX "GroupRoster_groupId_idx" ON "public"."GroupRoster"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupRoster_groupId_userId_key" ON "public"."GroupRoster"("groupId", "userId");

-- CreateIndex
CREATE INDEX "GroupAssignmentProblem_groupId_idx" ON "public"."GroupAssignmentProblem"("groupId");

-- CreateIndex
CREATE INDEX "AssignmentGrade_assignmentId_idx" ON "public"."AssignmentGrade"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentGrade_studentId_idx" ON "public"."AssignmentGrade"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentGrade_assignmentId_studentId_key" ON "public"."AssignmentGrade"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "Assignment_isGroup_idx" ON "public"."Assignment"("isGroup");

-- CreateIndex
CREATE INDEX "AssignmentProblemGrade_assignmentId_idx" ON "public"."AssignmentProblemGrade"("assignmentId");

-- CreateIndex
CREATE INDEX "Submission_groupId_idx" ON "public"."Submission"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_assignmentId_problemId_groupId_key" ON "public"."Submission"("assignmentId", "problemId", "groupId");

-- AddForeignKey
ALTER TABLE "public"."Group" ADD CONSTRAINT "Group_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "public"."Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupRoster" ADD CONSTRAINT "GroupRoster_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "public"."Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupRoster" ADD CONSTRAINT "GroupRoster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupRoster" ADD CONSTRAINT "GroupRoster_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupAssignmentProblem" ADD CONSTRAINT "GroupAssignmentProblem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupAssignmentProblem" ADD CONSTRAINT "GroupAssignmentProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "public"."Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GroupAssignmentProblem" ADD CONSTRAINT "GroupAssignmentProblem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Submission" ADD CONSTRAINT "Submission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssignmentGrade" ADD CONSTRAINT "AssignmentGrade_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssignmentGrade" ADD CONSTRAINT "AssignmentGrade_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
