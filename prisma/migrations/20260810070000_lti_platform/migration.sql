
-- AlterEnum
ALTER TYPE "SingleUseTokenPurpose" ADD VALUE 'LTI_LAUNCH_NONCE';

-- CreateTable
CREATE TABLE "LtiPlatform" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "authLoginUrl" TEXT NOT NULL,
    "tokenUrl" TEXT NOT NULL,
    "keysetUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LtiPlatform_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LtiPlatform_issuer_clientId_deploymentId_key" ON "LtiPlatform"("issuer", "clientId", "deploymentId");

