-- Optimize ActivityLog indexes for a high-write, admin-read log table.
-- Drop single-column indexes that are already covered by the leftmost prefix
-- of a composite index (redundant, and each one taxes every insert), and add
-- a [severity, timestamp] composite so the System Logs severity filter + default
-- timestamp ordering are served by a single index scan (no separate sort).

-- DropIndex
DROP INDEX "ActivityLog_userId_idx";
DROP INDEX "ActivityLog_severity_idx";
DROP INDEX "ActivityLog_courseId_idx";
DROP INDEX "ActivityLog_assignmentId_idx";

-- CreateIndex
CREATE INDEX "ActivityLog_severity_timestamp_idx" ON "ActivityLog"("severity", "timestamp");
