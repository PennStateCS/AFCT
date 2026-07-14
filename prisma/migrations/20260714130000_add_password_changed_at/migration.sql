-- Track when a user's password last changed, so a reset can invalidate older sessions.
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
