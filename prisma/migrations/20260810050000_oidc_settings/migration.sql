-- Institutional sign-in (OIDC). Off until an admin configures a provider and turns it on, so an
-- install using only local accounts behaves exactly as it did before.
ALTER TABLE "SystemSettings"
  ADD COLUMN "oidcEnabled"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "oidcIssuer"       TEXT,
  ADD COLUMN "oidcClientId"     TEXT,
  -- Encrypted at rest via AFCT_SECRET_KEY. Never returned to the browser.
  ADD COLUMN "oidcClientSecret" TEXT,
  ADD COLUMN "oidcButtonLabel"  TEXT,
  -- Off by default. Auto-linking normally requires the provider to assert email_verified, but
  -- Entra and Azure AD frequently omit that claim and are what most campuses run. Turning this
  -- on for a provider that lets people choose their own address would make an email a way to
  -- reach somebody else's account, so it is a deliberate, logged decision rather than a default.
  ADD COLUMN "oidcTrustEmail"   BOOLEAN NOT NULL DEFAULT false;
