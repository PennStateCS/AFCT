-- The server's own fingerprint of a submitted file, written when the file arrives rather
-- than during grading, so it covers both submission paths and problems with autograding off.
-- Read per problem only: a match means something among students answering the same question.

ALTER TABLE "Submission" ADD COLUMN "contentHash" TEXT;

CREATE INDEX "Submission_problemId_contentHash_idx" ON "Submission"("problemId", "contentHash");
