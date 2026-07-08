-- Add the global system-admin flag and backfill it from existing roles. FACULTY is
-- included as well as ADMIN because today FACULTY carries admin-equivalent access,
-- so existing faculty keep their current reach; going forward, admin is granted
-- deliberately and teaching is a per-course role. The `role` column is intentionally
-- left in place until the code migration to the user + isAdmin model is complete.
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "isAdmin" = true WHERE "role" IN ('ADMIN', 'FACULTY');

CREATE INDEX "User_isAdmin_idx" ON "User"("isAdmin");
