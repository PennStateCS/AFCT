-- Mail server settings, so AFCT can send a password-reset link without an admin relaying one
-- by hand. Off until an admin configures a server and turns it on, so an install that does not
-- want mail behaves exactly as it did before.
CREATE TYPE "SmtpSecurity" AS ENUM ('NONE', 'STARTTLS', 'TLS');

ALTER TABLE "SystemSettings"
  ADD COLUMN "smtpEnabled"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smtpHost"        TEXT,
  ADD COLUMN "smtpPort"        INTEGER,
  -- STARTTLS on 587 is what most institutional servers expect, so it is the default an admin
  -- starts from rather than a blank they have to guess at.
  ADD COLUMN "smtpSecurity"    "SmtpSecurity" NOT NULL DEFAULT 'STARTTLS',
  ADD COLUMN "smtpUsername"    TEXT,
  -- Encrypted at rest via AFCT_SECRET_KEY (see src/lib/secret-encryption.ts). Never returned
  -- to the browser: the API reports only whether a password is stored.
  ADD COLUMN "smtpPassword"    TEXT,
  ADD COLUMN "smtpFromAddress" TEXT,
  ADD COLUMN "smtpFromName"    TEXT;
