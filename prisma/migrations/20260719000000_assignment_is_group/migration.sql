-- Explicit Individual (false) vs Group (true) classification for assignments.
-- Defaults to individual; existing rows are backfilled to individual by the default.
ALTER TABLE "Assignment" ADD COLUMN "isGroup" BOOLEAN NOT NULL DEFAULT false;
