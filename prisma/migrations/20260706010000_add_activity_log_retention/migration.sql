-- Audit-log retention (days), editable in System Settings.
ALTER TABLE "SystemSettings" ADD COLUMN "activityLogRetentionDays" INTEGER NOT NULL DEFAULT 365;
