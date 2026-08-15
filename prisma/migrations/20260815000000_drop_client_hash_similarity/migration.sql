-- The first similarity attempt depended on hashes the native client wrote into the file,
-- and stored its findings on the submission. Matching is now done from `contentHash`, which
-- the server computes when a file arrives, so nothing reads these three columns any more
-- and nothing writes them either.
--
-- The code that produced them is kept on the plagerism_devector_v2 branch.

ALTER TABLE "Submission" DROP COLUMN "fileHashData";
ALTER TABLE "Submission" DROP COLUMN "calcHashData";
ALTER TABLE "Submission" DROP COLUMN "similarityReportJson";
