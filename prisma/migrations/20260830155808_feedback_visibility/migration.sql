-- AlterTable
ALTER TABLE "AssignmentProblem" ADD COLUMN     "showFeedback" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "feedbackShown" BOOLEAN;
