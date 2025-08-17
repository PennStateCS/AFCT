-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "courseId" TEXT,
    "assignmentId" TEXT,
    "problemId" TEXT,
    "submissionId" TEXT,
    "category" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityLog_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ActivityLog" ("action", "id", "metadata", "timestamp", "userId") SELECT "action", "id", "metadata", "timestamp", "userId" FROM "ActivityLog";
DROP TABLE "ActivityLog";
ALTER TABLE "new_ActivityLog" RENAME TO "ActivityLog";
CREATE INDEX "ActivityLog_timestamp_idx" ON "ActivityLog"("timestamp");
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");
CREATE INDEX "ActivityLog_action_idx" ON "ActivityLog"("action");
CREATE INDEX "ActivityLog_category_idx" ON "ActivityLog"("category");
CREATE INDEX "ActivityLog_courseId_idx" ON "ActivityLog"("courseId");
CREATE INDEX "ActivityLog_assignmentId_idx" ON "ActivityLog"("assignmentId");
CREATE INDEX "ActivityLog_problemId_idx" ON "ActivityLog"("problemId");
CREATE INDEX "ActivityLog_submissionId_idx" ON "ActivityLog"("submissionId");
CREATE INDEX "ActivityLog_courseId_action_idx" ON "ActivityLog"("courseId", "action");
CREATE INDEX "ActivityLog_assignmentId_action_idx" ON "ActivityLog"("assignmentId", "action");
CREATE INDEX "ActivityLog_userId_courseId_idx" ON "ActivityLog"("userId", "courseId");
CREATE INDEX "ActivityLog_timestamp_category_idx" ON "ActivityLog"("timestamp", "category");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
