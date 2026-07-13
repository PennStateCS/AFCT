-- Bearer tokens for the native submission client. Only the SHA-256 hash is stored.

-- CreateTable
CREATE TABLE "public"."ClientApiToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ClientApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientApiToken_tokenHash_key" ON "public"."ClientApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ClientApiToken_userId_idx" ON "public"."ClientApiToken"("userId");

-- AddForeignKey
ALTER TABLE "public"."ClientApiToken" ADD CONSTRAINT "ClientApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
