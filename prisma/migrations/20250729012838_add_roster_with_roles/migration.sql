/*
  Warnings:

  - You are about to drop the `_FacultyCourses` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_StudentCourses` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_TACourses` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `submissionId` on the `Comment` table. All the data in the column will be lost.
  - You are about to drop the column `attempt` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `content` on the `Submission` table. All the data in the column will be lost.
  - Added the required column `assignmentId` to the `Comment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `problemId` to the `Comment` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "_FacultyCourses_B_index";

-- DropIndex
DROP INDEX "_FacultyCourses_AB_unique";

-- DropIndex
DROP INDEX "_StudentCourses_B_index";

-- DropIndex
DROP INDEX "_StudentCourses_AB_unique";

-- DropIndex
DROP INDEX "_TACourses_B_index";

-- DropIndex
DROP INDEX "_TACourses_AB_unique";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "_FacultyCourses";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "_StudentCourses";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "_TACourses";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Roster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Roster_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Roster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATETIME NOT NULL,
    "maxPoints" REAL NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "courseId" TEXT NOT NULL,
    CONSTRAINT "Assignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Assignment" ("courseId", "createdAt", "description", "dueDate", "id", "isPublished", "maxPoints", "title", "updatedAt") SELECT "courseId", "createdAt", "description", "dueDate", "id", "isPublished", "maxPoints", "title", "updatedAt" FROM "Assignment";
DROP TABLE "Assignment";
ALTER TABLE "new_Assignment" RENAME TO "Assignment";
CREATE TABLE "new_AssignmentProblem" (
    "assignmentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,

    PRIMARY KEY ("assignmentId", "problemId"),
    CONSTRAINT "AssignmentProblem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssignmentProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AssignmentProblem" ("assignmentId", "problemId") SELECT "assignmentId", "problemId" FROM "AssignmentProblem";
DROP TABLE "AssignmentProblem";
ALTER TABLE "new_AssignmentProblem" RENAME TO "AssignmentProblem";
CREATE TABLE "new_Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignmentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    CONSTRAINT "Comment_assignmentId_problemId_fkey" FOREIGN KEY ("assignmentId", "problemId") REFERENCES "AssignmentProblem" ("assignmentId", "problemId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Comment" ("authorId", "content", "createdAt", "id") SELECT "authorId", "content", "createdAt", "id" FROM "Comment";
DROP TABLE "Comment";
ALTER TABLE "new_Comment" RENAME TO "Comment";
CREATE TABLE "new_Problem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT,
    "originalFileName" TEXT,
    "type" TEXT,
    "maxStates" INTEGER,
    "isDeterministic" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "courseId" TEXT NOT NULL,
    CONSTRAINT "Problem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Problem" ("courseId", "createdAt", "description", "fileName", "id", "isDeterministic", "maxStates", "originalFileName", "title", "type", "updatedAt") SELECT "courseId", "createdAt", "description", "fileName", "id", "isDeterministic", "maxStates", "originalFileName", "title", "type", "updatedAt" FROM "Problem";
DROP TABLE "Problem";
ALTER TABLE "new_Problem" RENAME TO "Problem";
CREATE TABLE "new_Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grade" REAL,
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
INSERT INTO "new_Submission" ("assignmentId", "createdAt", "feedback", "fileName", "grade", "id", "originalFileName", "problemId", "studentId", "submittedAt", "updatedAt") SELECT "assignmentId", "createdAt", "feedback", "fileName", "grade", "id", "originalFileName", "problemId", "studentId", "submittedAt", "updatedAt" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE INDEX "Submission_assignmentId_idx" ON "Submission"("assignmentId");
CREATE INDEX "Submission_studentId_idx" ON "Submission"("studentId");
CREATE INDEX "Submission_assignmentId_problemId_studentId_idx" ON "Submission"("assignmentId", "problemId", "studentId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "avatar" TEXT,
    "inactive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("avatar", "createdAt", "email", "firstName", "id", "lastName", "password", "role", "updatedAt") SELECT "avatar", "createdAt", "email", "firstName", "id", "lastName", "password", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Roster_courseId_userId_key" ON "Roster"("courseId", "userId");
