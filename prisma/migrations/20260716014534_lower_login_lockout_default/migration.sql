-- Lower the default per-account login lockout from 45 to 10 minutes. This changes
-- the column default for new installs only; existing SystemSettings rows keep the
-- value an administrator already configured.
ALTER TABLE "SystemSettings" ALTER COLUMN "loginLockoutMinutes" SET DEFAULT 10;
