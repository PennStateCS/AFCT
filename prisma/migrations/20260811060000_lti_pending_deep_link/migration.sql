
-- CreateTable
CREATE TABLE "LtiPendingDeepLink" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "contextId" TEXT,
    "returnUrl" TEXT NOT NULL,
    "data" TEXT,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiPendingDeepLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LtiPendingDeepLink_userId_idx" ON "LtiPendingDeepLink"("userId");

-- CreateIndex
CREATE INDEX "LtiPendingDeepLink_expiresAt_idx" ON "LtiPendingDeepLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "LtiPendingDeepLink" ADD CONSTRAINT "LtiPendingDeepLink_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "LtiPlatform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiPendingDeepLink" ADD CONSTRAINT "LtiPendingDeepLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

