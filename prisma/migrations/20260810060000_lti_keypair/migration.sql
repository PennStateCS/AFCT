
-- CreateTable
CREATE TABLE "LtiKeyPair" (
    "id" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "signingFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "LtiKeyPair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LtiKeyPair_kid_key" ON "LtiKeyPair"("kid");

-- CreateIndex
CREATE INDEX "LtiKeyPair_retiredAt_signingFrom_idx" ON "LtiKeyPair"("retiredAt", "signingFrom");

