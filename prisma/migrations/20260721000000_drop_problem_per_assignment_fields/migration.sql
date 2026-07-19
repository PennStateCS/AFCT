-- Drop the per-assignment fields that were duplicated on the Problem bank row. These
-- values are authored per problem<->assignment link and already live on AssignmentProblem
-- (maxPoints / maxSubmissions / autograderEnabled). Nothing reads the Problem-level copies
-- for behavior (the autograder and points totals use the AssignmentProblem values), so no
-- backfill is needed.
ALTER TABLE "Problem" DROP COLUMN "maxPoints";
ALTER TABLE "Problem" DROP COLUMN "maxSubmissions";
ALTER TABLE "Problem" DROP COLUMN "autograderEnabled";
