-- A group set's name is unique within its course, case-insensitively.
--
-- The routes have always checked it that way, but the constraint behind them was
-- `(courseId, name)`, which is exact. Two people creating "Project Teams" and
-- "project teams" at the same moment both passed the check and both rows landed,
-- because the only thing that could have stopped the second one did not consider
-- them equal. Prisma cannot express an index over an expression, so this is written
-- by hand; the schema keeps its own `@@unique([courseId, name])`, which this is
-- strictly narrower than.
--
-- Names are stored trimmed by the service layer, so lower() alone is enough here.
-- This will fail if a course already holds two sets whose names differ only by case,
-- which is the honest outcome: the rows have to be told apart before the rule can be
-- true, and failing the migration is how somebody finds out rather than the index
-- being quietly skipped.
CREATE UNIQUE INDEX "GroupSet_courseId_lower_name_key"
  ON "GroupSet" ("courseId", lower("name"));
