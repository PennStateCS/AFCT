-- AlterTable
ALTER TABLE "public"."SystemSettings"
  ADD COLUMN     "hcaptchaSiteKey" TEXT,
  ADD COLUMN     "hcaptchaSecretKey" TEXT;
