-- CreateIndex
CREATE INDEX "Submission_problemId_submittedAt_idx" ON "Submission"("problemId", "submittedAt");

-- CreateIndex
CREATE INDEX "Submission_courseId_submittedAt_idx" ON "Submission"("courseId", "submittedAt");

-- CreateIndex
CREATE INDEX "Submission_submittedAt_idx" ON "Submission"("submittedAt");
