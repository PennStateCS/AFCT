-- Database backup scheduling, editable in System Settings.
ALTER TABLE "SystemSettings" ADD COLUMN "backupEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "backupHour" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "SystemSettings" ADD COLUMN "backupRetentionDays" INTEGER NOT NULL DEFAULT 14;
