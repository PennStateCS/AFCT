-- Add the cfganalyzer exploration bound to system settings (was env-only: CFGANALYZER_LIMIT).
ALTER TABLE "SystemSettings" ADD COLUMN "submissionAnalyzerLimit" INTEGER NOT NULL DEFAULT 15;
