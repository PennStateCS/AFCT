-- AlterTable
ALTER TABLE "public"."AssignmentProblemGrade" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "public"."AssignmentProblemGrade" RENAME CONSTRAINT "AssignmentProblemGrade_assignmentProblem_fkey" TO "AssignmentProblemGrade_assignmentId_problemId_fkey";

-- RenameForeignKey
ALTER TABLE "public"."AssignmentProblemGrade" RENAME CONSTRAINT "AssignmentProblemGrade_student_fkey" TO "AssignmentProblemGrade_studentId_fkey";

-- RenameIndex
ALTER INDEX "public"."AssignmentProblemGrade_assignment_problem_idx" RENAME TO "AssignmentProblemGrade_assignmentId_problemId_idx";
