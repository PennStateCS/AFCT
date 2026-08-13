-- Deep Linking 2.0 requires accept_presentation_document_targets, and says that an absent
-- accept_lineitem licenses no assumption either way. The column defaulted to true, which turned
-- "the platform did not say" into "the platform said yes" and could attach a gradebook column to
-- a link the platform never agreed to take.

ALTER TABLE "LtiPendingDeepLink"
  ADD COLUMN "acceptPresentationDocumentTargets" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing rows carry `true` from the old default, which cannot be told apart from a platform
-- that actually said true. They are pending choices with a ten-minute life, so rather than guess
-- at what each one meant, the unfinished ones go and the LMS can ask again.
DELETE FROM "LtiPendingDeepLink";

ALTER TABLE "LtiPendingDeepLink"
  ALTER COLUMN "acceptPresentationDocumentTargets" DROP DEFAULT;

ALTER TABLE "LtiPendingDeepLink"
  ALTER COLUMN "acceptLineItem" DROP DEFAULT,
  ALTER COLUMN "acceptLineItem" DROP NOT NULL;
