
-- CreateTable
CREATE TABLE "LtiPendingLink" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "contextTitle" TEXT,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiPendingLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LtiPendingLink_userId_idx" ON "LtiPendingLink"("userId");

-- CreateIndex
CREATE INDEX "LtiPendingLink_expiresAt_idx" ON "LtiPendingLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "LtiContextLink" ADD CONSTRAINT "LtiContextLink_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiPendingLink" ADD CONSTRAINT "LtiPendingLink_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "LtiPlatform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
