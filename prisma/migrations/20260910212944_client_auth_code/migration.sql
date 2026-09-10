-- CreateTable
CREATE TABLE "ClientAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pkceChallenge" TEXT NOT NULL,
    "redirectUri" TEXT,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "ClientAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAuthCode_codeHash_key" ON "ClientAuthCode"("codeHash");

-- CreateIndex
CREATE INDEX "ClientAuthCode_userId_idx" ON "ClientAuthCode"("userId");

-- CreateIndex
CREATE INDEX "ClientAuthCode_expiresAt_idx" ON "ClientAuthCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "ClientAuthCode" ADD CONSTRAINT "ClientAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
