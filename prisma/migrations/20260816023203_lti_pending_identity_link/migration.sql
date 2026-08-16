-- CreateTable
CREATE TABLE "LtiPendingIdentityLink" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "next" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiPendingIdentityLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LtiPendingIdentityLink_expiresAt_idx" ON "LtiPendingIdentityLink"("expiresAt");

-- AddForeignKey
ALTER TABLE "LtiPendingIdentityLink" ADD CONSTRAINT "LtiPendingIdentityLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
