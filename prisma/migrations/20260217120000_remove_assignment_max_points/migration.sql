-- Drop assignment-level maxPoints column; assignment totals are derived from linked problems
ALTER TABLE "Assignment"
  DROP COLUMN "maxPoints";
