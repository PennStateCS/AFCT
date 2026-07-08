-- Per-account login lockout policy, editable in System Settings.
ALTER TABLE "SystemSettings" ADD COLUMN "loginMaxAttempts" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "SystemSettings" ADD COLUMN "loginLockoutMinutes" INTEGER NOT NULL DEFAULT 45;
