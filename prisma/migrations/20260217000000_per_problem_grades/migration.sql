-- Ensure pgcrypto is available for random byte generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Provide a Postgres-side cuid() helper so Prisma defaults work in fresh databases
CREATE OR REPLACE FUNCTION "public"."cuid"() RETURNS TEXT AS $$
BEGIN
  RETURN 'c' || substr(encode(gen_random_bytes(16), 'hex'), 1, 24);
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Drop obsolete assignment-level grades
DROP TABLE IF EXISTS "AssignmentGrade";

-- Create per-problem grade table keyed by assignment/problem/student
CREATE TABLE "AssignmentProblemGrade" (
  "id" TEXT PRIMARY KEY DEFAULT ("public"."cuid"()),
    "grade" DOUBLE PRECISION,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignmentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    CONSTRAINT "AssignmentProblemGrade_assignmentProblem_fkey" FOREIGN KEY ("assignmentId", "problemId") REFERENCES "AssignmentProblem" ("assignmentId", "problemId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentProblemGrade_student_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AssignmentProblemGrade_assignmentId_problemId_studentId_key"
  ON "AssignmentProblemGrade" ("assignmentId", "problemId", "studentId");

CREATE INDEX "AssignmentProblemGrade_assignment_problem_idx"
  ON "AssignmentProblemGrade" ("assignmentId", "problemId");

CREATE INDEX "AssignmentProblemGrade_studentId_idx"
  ON "AssignmentProblemGrade" ("studentId");
