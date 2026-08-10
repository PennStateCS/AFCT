-- A user will be able to exist without a local password: an identity provider or an LMS launch
-- can vouch for someone who never chose one. Nothing creates such an account yet, so no rows
-- change here; this only stops the column insisting on a value.
--
-- Dropping NOT NULL is not reversible without knowing what to backfill, which is the right way
-- round: an account with no password must never silently acquire one.
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
