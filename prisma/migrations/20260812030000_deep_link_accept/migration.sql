-- What the platform said it will accept back from a deep linking request, so the response can
-- honour it instead of always sending a resource link with a gradebook column.
ALTER TABLE "LtiPendingDeepLink" ADD COLUMN "acceptTypes" TEXT[];
ALTER TABLE "LtiPendingDeepLink" ADD COLUMN "acceptLineItem" BOOLEAN NOT NULL DEFAULT true;
