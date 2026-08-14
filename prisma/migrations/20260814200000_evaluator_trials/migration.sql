-- Staff dry runs of the evaluator: two uploaded files run through the real jar, with no grade
-- attached. Not rows in Submission, which is what grades are computed from. The uploads are
-- usually a student's own work, so the files are deleted when the run ends and the row expires.

CREATE TYPE "EvaluatorTrialState" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "EvaluatorTrial" (
  "id" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "problemType" "ProblemType" NOT NULL,
  "maxStates" INTEGER,
  "isDeterministic" BOOLEAN,
  "answerFileName" TEXT,
  "submissionFileName" TEXT,
  "answerOriginalName" TEXT NOT NULL,
  "submissionOriginalName" TEXT NOT NULL,
  "state" "EvaluatorTrialState" NOT NULL DEFAULT 'PENDING',
  "correct" BOOLEAN,
  "feedback" TEXT,
  "evaluationRaw" JSONB,
  "stderr" TEXT,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvaluatorTrial_pkey" PRIMARY KEY ("id")
);

-- The claim order (oldest waiting first), the per-user running cap, and the expiry sweep.
CREATE INDEX "EvaluatorTrial_state_createdAt_idx" ON "EvaluatorTrial"("state", "createdAt");
CREATE INDEX "EvaluatorTrial_requestedById_state_idx" ON "EvaluatorTrial"("requestedById", "state");
CREATE INDEX "EvaluatorTrial_expiresAt_idx" ON "EvaluatorTrial"("expiresAt");

-- Cascade: a deleted account takes its trials with it. Nothing depends on them.
ALTER TABLE "EvaluatorTrial" ADD CONSTRAINT "EvaluatorTrial_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
