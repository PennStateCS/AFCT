-- Mark grades set by hand so the autograder won't overwrite them.
ALTER TABLE "AssignmentProblemGrade" ADD COLUMN "gradedManually" BOOLEAN NOT NULL DEFAULT false;
