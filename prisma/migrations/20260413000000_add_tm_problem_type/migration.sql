DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'ProblemType'
      AND e.enumlabel = 'TM'
  ) THEN
    ALTER TYPE "ProblemType" ADD VALUE 'TM';
  END IF;
END $$;
