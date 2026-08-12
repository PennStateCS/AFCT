-- Which LMS course a person belongs to, so grade passback stops guessing between the several
-- LMS courses that can open one AFCT course.
CREATE TABLE "LtiContextMember" (
    "id" TEXT NOT NULL,
    "contextLinkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ltiUserId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LtiContextMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LtiContextMember_contextLinkId_userId_key" ON "LtiContextMember"("contextLinkId", "userId");
CREATE INDEX "LtiContextMember_userId_idx" ON "LtiContextMember"("userId");

ALTER TABLE "LtiContextMember" ADD CONSTRAINT "LtiContextMember_contextLinkId_fkey"
    FOREIGN KEY ("contextLinkId") REFERENCES "LtiContextLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LtiContextMember" ADD CONSTRAINT "LtiContextMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
