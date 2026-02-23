-- Adding Problem.maxSubmissions and Problem.maxPoints columns
ALTER TABLE "Problem"
  ADD COLUMN IF NOT EXISTS "maxSubmissions" INTEGER,
  ADD COLUMN IF NOT EXISTS "currPoints" INTEGER,
  ADD COLUMN IF NOT EXISTS "maxPoints" INTEGER NOT NULL DEFAULT 100;