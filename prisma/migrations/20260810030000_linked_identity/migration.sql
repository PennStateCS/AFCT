-- An institutional identity mapped to an AFCT account: an OIDC sign-in, or someone arriving
-- through an LMS launch. Accounts stay the unit of identity; this is not a parallel user table.
CREATE TYPE "IdentityProviderKind" AS ENUM ('OIDC', 'LTI');

CREATE TYPE "IdentityLinkMethod" AS ENUM (
  'AUTO_VERIFIED_EMAIL',
  'JUST_IN_TIME',
  'SELF_SERVICE',
  'ADMIN'
);

CREATE TABLE "LinkedIdentity" (
  "id"           TEXT NOT NULL,
  "kind"         "IdentityProviderKind" NOT NULL,
  "issuer"       TEXT NOT NULL,
  "subject"      TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "linkedVia"    "IdentityLinkMethod" NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSignInAt" TIMESTAMP(3),

  CONSTRAINT "LinkedIdentity_pkey" PRIMARY KEY ("id")
);

-- Keyed on issuer plus subject, never email. The subject is the provider's stable identifier,
-- so a link survives a name change or a new address; email is used once to find the account to
-- attach to and is not what holds the link together afterwards.
--
-- The uniqueness is the load-bearing part: it stops two accounts sharing one sign-in, and stops
-- an identity quietly moving from one account to another.
CREATE UNIQUE INDEX "LinkedIdentity_issuer_subject_key" ON "LinkedIdentity"("issuer", "subject");

CREATE INDEX "LinkedIdentity_userId_idx" ON "LinkedIdentity"("userId");

-- Deleting an account takes its sign-ins with it. A link outliving its user would be an
-- identity that resolves to nothing, and the next person to be given that email should not
-- inherit it.
ALTER TABLE "LinkedIdentity"
  ADD CONSTRAINT "LinkedIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
