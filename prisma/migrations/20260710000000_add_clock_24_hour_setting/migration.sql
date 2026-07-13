-- App-wide date/time display preference: 24-hour vs 12-hour clock. Display-only —
-- never affects stored UTC instants or deadline enforcement.
ALTER TABLE "public"."SystemSettings" ADD COLUMN "clock24Hour" BOOLEAN NOT NULL DEFAULT false;
