-- What the platform said about taking more than one item back. Nullable for the same reason
-- acceptLineItem is: Deep Linking 2.0 gives accept_multiple no default when it is absent, so
-- "the platform did not say" is a third state rather than a no.
--
-- AFCT returns one assignment per response, so nothing reads this yet. It is stored rather than
-- parsed and dropped so that the value survives to the picker, which is where multi-assignment
-- selection would eventually need it.
ALTER TABLE "LtiPendingDeepLink" ADD COLUMN "acceptMultiple" BOOLEAN;
