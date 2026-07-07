-- Drop the vestigial global User.role. System-wide privilege is now the `isAdmin`
-- flag; per-course ability lives on Roster.role. Dropping the column also drops its
-- index; the Role enum type is then unused and removed.

DROP INDEX IF EXISTS "User_role_idx";
ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "Role";
