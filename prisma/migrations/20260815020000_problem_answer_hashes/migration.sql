-- Fingerprints of a problem's own reference solution, taken the same way a submission's are,
-- so the Similarity tab can say when matching work is simply the posted answer.

ALTER TABLE "Problem" ADD COLUMN "answerContentHash" TEXT;
ALTER TABLE "Problem" ADD COLUMN "answerShapeHash" TEXT;
