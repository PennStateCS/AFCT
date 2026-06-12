/*
  Warnings:

  - You are about to drop the `AssignmentGrade` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."AssignmentGrade" DROP CONSTRAINT "AssignmentGrade_assignmentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."AssignmentGrade" DROP CONSTRAINT "AssignmentGrade_studentId_fkey";

-- DropTable
DROP TABLE "public"."AssignmentGrade";
