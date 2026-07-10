-- Allow-list of email domains permitted to self-register. Canonical, comma-separated
-- (e.g. "psu.edu,example.edu"). Blank = no restriction (any domain may sign up).
ALTER TABLE "public"."SystemSettings" ADD COLUMN "signupAllowedDomains" TEXT NOT NULL DEFAULT '';
