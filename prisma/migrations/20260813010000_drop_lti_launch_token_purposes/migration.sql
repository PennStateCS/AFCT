-- The launch nonce and state moved onto LtiLaunchTransaction, which holds them on one row so
-- that a returning token can be checked against the login that started it. Nothing has issued a
-- single-use token for either purpose since, so the values go rather than sit in the type
-- looking like something a new purpose could be modelled on.

DELETE FROM "SingleUseToken" WHERE "purpose" IN ('LTI_LAUNCH_NONCE', 'LTI_LAUNCH_STATE');

-- Postgres cannot drop a value from an enum, so the type is rebuilt and the column moved across.
-- The cast goes via text because the old and new types are unrelated as far as Postgres knows.
ALTER TYPE "SingleUseTokenPurpose" RENAME TO "SingleUseTokenPurpose_old";

CREATE TYPE "SingleUseTokenPurpose" AS ENUM ('PASSWORD_RESET', 'LTI_SESSION_TICKET');

ALTER TABLE "SingleUseToken"
  ALTER COLUMN "purpose" TYPE "SingleUseTokenPurpose"
  USING ("purpose"::text::"SingleUseTokenPurpose");

DROP TYPE "SingleUseTokenPurpose_old";
