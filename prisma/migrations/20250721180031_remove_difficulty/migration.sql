/*
  Warnings:

  - You are about to drop the column `difficulty` on the `Problem` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "Problem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Problem" ("courseId", "createdAt", "description", "fileName", "id", "isDeterministic", "maxStates", "originalFileName", "title", "type", "updatedAt") SELECT "courseId", "createdAt", "description", "fileName", "id", "isDeterministic", "maxStates", "originalFileName", "title", "type", "updatedAt" FROM "Problem";
DROP TABLE "Problem";
ALTER TABLE "new_Problem" RENAME TO "Problem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
