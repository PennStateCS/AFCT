-- Give comments a direct author (User) and make the roster link optional.
-- The roster is now only the author's course role (for the role badge); it is null
-- when the author isn't rostered (e.g. a system admin commenting on a course they
-- aren't enrolled in), so we no longer fabricate a roster row to attribute a comment.

-- 1) Add authorId, backfill from the existing roster's user, then enforce NOT NULL.
ALTER TABLE "public"."Comment" ADD COLUMN "authorId" TEXT;
UPDATE "public"."Comment" c
  SET "authorId" = r."userId"
  FROM "public"."Roster" r
  WHERE r."id" = c."rosterId";
ALTER TABLE "public"."Comment" ALTER COLUMN "authorId" SET NOT NULL;

-- 2) Make rosterId optional.
ALTER TABLE "public"."Comment" ALTER COLUMN "rosterId" DROP NOT NULL;

-- 3) Roster FK: was ON DELETE CASCADE (rosterId required); now SET NULL (optional),
--    so deleting a roster row keeps the comment but clears its role badge.
ALTER TABLE "public"."Comment" DROP CONSTRAINT "Comment_rosterId_fkey";
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_rosterId_fkey"
  FOREIGN KEY ("rosterId") REFERENCES "public"."Roster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Author FK + index.
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Comment_authorId_idx" ON "public"."Comment"("authorId");
