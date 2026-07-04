-- Severity/level for audit-log entries.
CREATE TYPE "LogSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'SECURITY');

ALTER TABLE "ActivityLog" ADD COLUMN "severity" "LogSeverity" NOT NULL DEFAULT 'INFO';

CREATE INDEX "ActivityLog_severity_idx" ON "ActivityLog"("severity");
