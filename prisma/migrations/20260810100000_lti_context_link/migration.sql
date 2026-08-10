
-- CreateTable
CREATE TABLE "LtiContextLink" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "contextTitle" TEXT,
    "courseId" TEXT NOT NULL,
    "linkedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiContextLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LtiContextLink_courseId_idx" ON "LtiContextLink"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "LtiContextLink_platformId_contextId_key" ON "LtiContextLink"("platformId", "contextId");

-- AddForeignKey
ALTER TABLE "LtiContextLink" ADD CONSTRAINT "LtiContextLink_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "LtiPlatform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiContextLink" ADD CONSTRAINT "LtiContextLink_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
