-- Serves "what has this address done recently", which the System Status rate-limit panel
-- runs on every refresh. Without it that lookup scans the log by timestamp and filters.
CREATE INDEX "ActivityLog_ipAddress_timestamp_idx" ON "public"."ActivityLog"("ipAddress", "timestamp");
