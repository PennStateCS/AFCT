-- Soft-delete for courses: a deleted course is retained for recovery but hidden from
-- all non-admin views and inaccessible through the app. Deletion requires the course
-- to already be archived, so a deleted course is always archived too.

ALTER TABLE "public"."Course" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "Course_deletedAt_idx" ON "public"."Course"("deletedAt");
