
-- AlterTable
ALTER TABLE "LtiContextLink" ADD COLUMN     "lineItemsUrl" TEXT;

-- CreateTable
CREATE TABLE "LtiLineItem" (
    "id" TEXT NOT NULL,
    "contextLinkId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LtiLineItem_assignmentId_idx" ON "LtiLineItem"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LtiLineItem_contextLinkId_assignmentId_key" ON "LtiLineItem"("contextLinkId", "assignmentId");

-- AddForeignKey
ALTER TABLE "LtiPendingLink" ADD CONSTRAINT "LtiPendingLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiLineItem" ADD CONSTRAINT "LtiLineItem_contextLinkId_fkey" FOREIGN KEY ("contextLinkId") REFERENCES "LtiContextLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
