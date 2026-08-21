-- AlterTable
ALTER TABLE "LtiDeepLink" ADD COLUMN     "confirmedAt" TIMESTAMP(3);

-- Every link that already exists was made before AFCT could tell the two states apart, so
-- treating them as unconfirmed would put genuine links back in the picker and invite a second
-- copy of each in the LMS. Stranded rows stay removable on the assignment's Settings tab.
UPDATE "LtiDeepLink" SET "confirmedAt" = "createdAt" WHERE "confirmedAt" IS NULL;
