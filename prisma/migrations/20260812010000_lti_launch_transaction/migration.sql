-- One row per LTI launch, binding the state, the nonce, the registration and the target link
-- URI that the login endpoint was given. Replaces two unrelated single-use tokens.
CREATE TABLE "LtiLaunchTransaction" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "targetLinkUri" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiLaunchTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LtiLaunchTransaction_stateHash_key" ON "LtiLaunchTransaction"("stateHash");
CREATE UNIQUE INDEX "LtiLaunchTransaction_nonceHash_key" ON "LtiLaunchTransaction"("nonceHash");
CREATE INDEX "LtiLaunchTransaction_platformId_idx" ON "LtiLaunchTransaction"("platformId");
CREATE INDEX "LtiLaunchTransaction_expiresAt_idx" ON "LtiLaunchTransaction"("expiresAt");

ALTER TABLE "LtiLaunchTransaction" ADD CONSTRAINT "LtiLaunchTransaction_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "LtiPlatform"("id") ON DELETE CASCADE ON UPDATE CASCADE;
