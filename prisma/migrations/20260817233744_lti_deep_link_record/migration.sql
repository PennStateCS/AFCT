-- CreateTable
CREATE TABLE "LtiDeepLink" (
    "id" TEXT NOT NULL,
    "contextLinkId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiDeepLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LtiDeepLink_assignmentId_idx" ON "LtiDeepLink"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LtiDeepLink_contextLinkId_assignmentId_key" ON "LtiDeepLink"("contextLinkId", "assignmentId");

-- AddForeignKey
ALTER TABLE "LtiDeepLink" ADD CONSTRAINT "LtiDeepLink_contextLinkId_fkey" FOREIGN KEY ("contextLinkId") REFERENCES "LtiContextLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiDeepLink" ADD CONSTRAINT "LtiDeepLink_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiDeepLink" ADD CONSTRAINT "LtiDeepLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
