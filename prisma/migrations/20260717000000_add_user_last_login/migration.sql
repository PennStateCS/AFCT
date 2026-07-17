-- Track the last successful sign-in per user (stored so it survives log purges).
ALTER TABLE "User" ADD COLUMN "lastLogin" TIMESTAMP(3);
