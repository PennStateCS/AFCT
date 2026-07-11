-- Align the Assignment.allowLateSubmissions column default with the application,
-- which defaults it to false (both the create form and the API). Only the column
-- default for future direct inserts changes; existing assignments keep whatever
-- value they were created with — the app always sets this explicitly, so existing
-- rows reflect real per-assignment choices and must NOT be rewritten.
ALTER TABLE "public"."Assignment"
ALTER COLUMN "allowLateSubmissions" SET DEFAULT false;
