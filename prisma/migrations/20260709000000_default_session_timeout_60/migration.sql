-- Raise the default idle-session timeout from 20 to 60 minutes. Change the column
-- default for new installs, and bump any existing row still on the old default;
-- a value an admin deliberately set to something other than 20 is left alone.
ALTER TABLE "public"."SystemSettings"
ALTER COLUMN "sessionTimeoutMinutes" SET DEFAULT 60;

UPDATE "public"."SystemSettings"
SET "sessionTimeoutMinutes" = 60
WHERE "sessionTimeoutMinutes" = 20;
