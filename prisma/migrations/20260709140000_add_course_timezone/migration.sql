-- Each course carries a canonical IANA timezone that anchors its deadlines. Staff
-- wall-times are interpreted in this zone and stored as UTC, so a due date means the
-- same instant for every student.

ALTER TABLE "public"."Course" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- Backfill existing courses from the configured system timezone (falls back to UTC).
UPDATE "public"."Course"
  SET "timezone" = COALESCE(
    (SELECT "timezone" FROM "public"."SystemSettings" WHERE "id" = 1),
    'UTC'
  );
