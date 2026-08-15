-- The second fingerprint: the same file with its layout, state names and ordering removed,
-- so a copied submission still matches after somebody drags the nodes around or renames the
-- states. Read per problem, like the first one.

ALTER TABLE "Submission" ADD COLUMN "shapeHash" TEXT;

CREATE INDEX "Submission_problemId_shapeHash_idx" ON "Submission"("problemId", "shapeHash");
