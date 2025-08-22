/*
  Warnings:

  - You are about to drop the column `grade` on the `Submission` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "AssignmentGrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grade" REAL NOT NULL,
    "feedback" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    CONSTRAINT "AssignmentGrade_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssignmentGrade_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedback" TEXT,
    "correct" BOOLEAN,
    "fileName" TEXT,
    "originalFileName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    CONSTRAINT "Submission_assignmentId_problemId_fkey" FOREIGN KEY ("assignmentId", "problemId") REFERENCES "AssignmentProblem" ("assignmentId", "problemId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Submission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Submission" ("assignmentId", "correct", "createdAt", "feedback", "fileName", "id", "originalFileName", "problemId", "studentId", "submittedAt", "updatedAt") SELECT "assignmentId", "correct", "createdAt", "feedback", "fileName", "id", "originalFileName", "problemId", "studentId", "submittedAt", "updatedAt" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE INDEX "Submission_assignmentId_idx" ON "Submission"("assignmentId");
CREATE INDEX "Submission_studentId_idx" ON "Submission"("studentId");
CREATE INDEX "Submission_assignmentId_problemId_studentId_idx" ON "Submission"("assignmentId", "problemId", "studentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AssignmentGrade_assignmentId_idx" ON "AssignmentGrade"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentGrade_studentId_idx" ON "AssignmentGrade"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentGrade_assignmentId_studentId_key" ON "AssignmentGrade"("assignmentId", "studentId");
