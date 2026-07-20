-- Auto-expiring account lockout. Nullable; NULL means not locked.
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
