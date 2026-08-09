-- Tokens that work exactly once, within a time window. The password-reset link is the first
-- user; anything similar should reuse this rather than growing its own table with its own
-- subtly different idea of expiry and reuse.
CREATE TYPE "SingleUseTokenPurpose" AS ENUM ('PASSWORD_RESET');

CREATE TABLE "SingleUseToken" (
  "id"        TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose"   "SingleUseTokenPurpose" NOT NULL,
  "userId"    TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SingleUseToken_pkey" PRIMARY KEY ("id")
);

-- The lookup is by hash, and uniqueness is what makes "spend this token" a single conditional
-- update rather than a read followed by a write.
CREATE UNIQUE INDEX "SingleUseToken_tokenHash_key" ON "SingleUseToken"("tokenHash");

CREATE INDEX "SingleUseToken_userId_purpose_idx" ON "SingleUseToken"("userId", "purpose");

-- Read by the periodic sweep of expired rows.
CREATE INDEX "SingleUseToken_expiresAt_idx" ON "SingleUseToken"("expiresAt");

-- Deleting a user takes their outstanding links with them; a reset link that outlived its
-- account would be a way back into a deleted identity.
ALTER TABLE "SingleUseToken"
  ADD CONSTRAINT "SingleUseToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
