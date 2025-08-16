-- AlterTable
ALTER TABLE "Problem" ADD COLUMN "fileName" TEXT;
ALTER TABLE "Problem" ADD COLUMN "isDeterministic" BOOLEAN;
ALTER TABLE "Problem" ADD COLUMN "maxStates" INTEGER;
ALTER TABLE "Problem" ADD COLUMN "type" TEXT;

-- CreateTable
CREATE TABLE "AssignmentProblem" (
    "assignmentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,

    PRIMARY KEY ("assignmentId", "problemId"),
    CONSTRAINT "AssignmentProblem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
